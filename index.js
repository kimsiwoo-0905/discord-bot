require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ChannelType,
  PermissionsBitField,
  Partials,
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel], // DM 채널 안정성
});

const INTERVAL_MS = 2000;
const MAX_MESSAGE_LEN = 1500;
const MAX_COUNT = 50;

// userId -> Map(channelId, { stop: boolean })
const runningByUser = new Map();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getUserRunMap(userId) {
  let m = runningByUser.get(userId);
  if (!m) {
    m = new Map();
    runningByUser.set(userId, m);
  }
  return m;
}

function canSendInGuildChannel(interaction) {
  if (!interaction.guild || !interaction.channel || !interaction.guild.members?.me) return false;
  const me = interaction.guild.members.me;
  const perms = interaction.channel.permissionsFor(me);
  return !!perms?.has(PermissionsBitField.Flags.ViewChannel) &&
         !!perms?.has(PermissionsBitField.Flags.SendMessages);
}

/**
 * ✅ 반복 전송은 "채널 메시지 send"로만 보냄 (followUp 제한 회피)
 * - 서버: interaction.channel.send() (봇이 해당 채널에 View/Send 권한 있어야 함)
 * - DM: user.createDM()로 DM 채널 만든 뒤 send() (유저가 DM 차단하면 50007)
 */
async function sendByChannel(interaction, content) {
  // DM이면: 사용자 DM 채널로 보내기
  if (interaction.channel?.type === ChannelType.DM) {
    const dm = await interaction.user.createDM();
    return dm.send({ content });
  }

  // 서버면 권한 체크
  if (interaction.guild) {
    if (!canSendInGuildChannel(interaction)) {
      const err = new Error("MISSING_ACCESS_GUILD_SEND");
      err.code = "MISSING_ACCESS_GUILD_SEND";
      throw err;
    }
    return interaction.channel.send({ content });
  }

  // 혹시 channel 객체가 없으면 fetch 후 send
  const ch = await interaction.client.channels.fetch(interaction.channelId);
  return ch.send({ content });
}

client.once("ready", () => {
  console.log(`로그인됨: ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  // 1) 슬래시 명령
  if (interaction.isChatInputCommand()) {
    const userId = interaction.user.id;
    const channelId = interaction.channelId;

    if (interaction.commandName === "도배") {
      const userRun = getUserRunMap(userId);
      if (userRun.has(channelId)) {
        return interaction.reply({ content: "진행 중입니다. (/도배중지로 중지)", ephemeral: true });
      }

      const modal = new ModalBuilder()
        .setCustomId("dobae_modal")
        .setTitle("도배 설정");

      const msgInput = new TextInputBuilder()
        .setCustomId("dobae_message")
        .setLabel("보낼 메시지 (1500자 이내)")
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(MAX_MESSAGE_LEN)
        .setRequired(true);

      const countInput = new TextInputBuilder()
        .setCustomId("dobae_count")
        .setLabel("반복 횟수 (숫자만, 1~50)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("예: 10")
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(msgInput),
        new ActionRowBuilder().addComponents(countInput)
      );

      return interaction.showModal(modal);
    }

    if (interaction.commandName === "도배중지") {
      const userRun = getUserRunMap(userId);
      if (userRun.size === 0) {
        return interaction.reply({ content: "진행 중인 도배가 없어요.", ephemeral: true });
      }

      for (const state of userRun.values()) state.stop = true;
      userRun.clear();

      return interaction.reply({ content: "도배를 중지했어요.", ephemeral: true });
    }
  }

  // 2) 모달 제출
  if (interaction.isModalSubmit()) {
    if (interaction.customId !== "dobae_modal") return;

    const userId = interaction.user.id;
    const channelId = interaction.channelId;

    const message = (interaction.fields.getTextInputValue("dobae_message") ?? "").trim();
    const countStr = (interaction.fields.getTextInputValue("dobae_count") ?? "").trim();

    if (!message) return interaction.reply({ content: "메시지를 입력해주세요.", ephemeral: true });
    if (message.length > MAX_MESSAGE_LEN) {
      return interaction.reply({ content: `메시지는 ${MAX_MESSAGE_LEN}자 이내만 가능해요.`, ephemeral: true });
    }

    if (!/^\d+$/.test(countStr)) {
      return interaction.reply({ content: "반복 횟수는 숫자만 입력해주세요. (1~50)", ephemeral: true });
    }

    const count = parseInt(countStr, 10);
    if (count < 1 || count > MAX_COUNT) {
      return interaction.reply({ content: "반복 횟수는 1~50 사이만 가능해요.", ephemeral: true });
    }

    const userRun = getUserRunMap(userId);
    if (userRun.has(channelId)) {
      return interaction.reply({ content: "이미 진행 중 입니다.", ephemeral: true });
    }

    userRun.set(channelId, { stop: false });

    // 시작 안내(나만 보이게 1번만)
    await interaction.reply({ content: `전송 시작! (${count}회, 2초 간격)`, ephemeral: true });

    // ✅ 서버에서 권한 없으면 "바로" 안내하고 중지 (무한 에러 방지)
    if (interaction.guild && !canSendInGuildChannel(interaction)) {
      getUserRunMap(userId).delete(channelId);
      return interaction.followUp({
        content:
          "이 채널에서 봇이 메시지를 보낼 권한이 없어요. (Missing Access)\n" +
          "✅ 해결:\n" +
          "1) 봇을 bot scope로 서버에 초대\n" +
          "2) 채널 권한에서 봇(또는 봇 역할)에 View Channel + Send Messages 허용",
        ephemeral: true,
      });
    }

    try {
      for (let i = 0; i < count; i++) {
        const current = getUserRunMap(userId).get(channelId);
        if (!current || current.stop) break;

        console.log(`[SEND] ${i + 1}/${count} channel=${channelId} type=${interaction.channel?.type}`);

        try {
          await sendByChannel(interaction, message);
        } catch (e) {
          const code = e?.code || e?.rawError?.code;
          const emsg = e?.rawError?.message || e?.message || String(e);

          console.error("SEND ERROR:", code || "", emsg);

          // DM 차단(유저 설정)일 때
          if (code === 50007) {
            await interaction.followUp({
              content:
                "DM으로 메시지를 보낼 수 없어요. (사용자가 DM을 차단했거나 개인정보 설정으로 막힘)\n" +
                "✅ 해결: 디스코드 설정에서 ‘DM 허용’ 또는 봇 차단 해제 후 다시 시도",
              ephemeral: true,
            });
          }
          // 서버 권한 문제일 때
          else if (e?.code === "MISSING_ACCESS_GUILD_SEND" || emsg.includes("Missing Access")) {
            await interaction.followUp({
              content:
                "전송 실패: Missing Access (이 채널에서 봇 권한이 없음)\n" +
                "채널 권한(View Channel / Send Messages)을 허용해주세요.",
              ephemeral: true,
            });
          } else {
            await interaction.followUp({ content: `전송 실패: ${emsg}`, ephemeral: true });
          }
          break;
        }

        if (i !== count - 1) await sleep(INTERVAL_MS);
      }
    } finally {
      getUserRunMap(userId).delete(channelId);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
