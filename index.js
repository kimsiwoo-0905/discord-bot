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
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
});

const INTERVAL_MS = 2000;
const MAX_MESSAGE_LEN = 1500;
const MAX_COUNT = 50;

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

function hasSendPerms(interaction) {
  if (!interaction.guild || !interaction.channel || !interaction.guild.members?.me) return false;
  const me = interaction.guild.members.me;
  const perms = interaction.channel.permissionsFor(me);
  return !!perms?.has(PermissionsBitField.Flags.SendMessages);
}

async function sendInPlace(interaction, content) {
  // DM은 createDM으로 send
  if (interaction.channel?.type === ChannelType.DM) {
    const dm = await interaction.user.createDM();
    return dm.send({ content });
  }

  // 서버는 channel.send (봇 초대 + 권한 필요)
  if (!hasSendPerms(interaction)) {
    throw new Error("SERVER_SEND_NOT_ALLOWED");
  }
  return interaction.channel.send({ content });
}

client.once("ready", () => {
  console.log(`로그인됨: ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const userId = interaction.user.id;
    const channelId = interaction.channelId;

    if (interaction.commandName === "도배") {
      const userRun = getUserRunMap(userId);
      if (userRun.has(channelId)) {
        return interaction.reply({ content: "진행 중입니다.", ephemeral: true });
      }

      const modal = new ModalBuilder().setCustomId("dobae_modal").setTitle("도배 설정");

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

    // 시작 안내는 나만 보이게 1번만
    await interaction.reply({ content: `전송 시작! (${count}회, 2초 간격)`, ephemeral: true });

    try {
      // 서버면 미리 권한 체크해서 바로 안내
      if (interaction.guild && !hasSendPerms(interaction)) {
        await interaction.followUp({
          content:
            "이 서버/채널에서 봇이 메시지를 보낼 권한이 없어요.\n" +
            "✅ 해결: 봇을 **bot 초대 링크**로 서버에 초대하고, 해당 채널에서 **Send Messages / View Channel** 권한을 주세요.",
          ephemeral: true,
        });
        return;
      }

      for (let i = 0; i < count; i++) {
        const current = getUserRunMap(userId).get(channelId);
        if (!current || current.stop) break;

        console.log(`[SEND] ${i + 1}/${count} channel=${channelId}`);

        try {
          await sendInPlace(interaction, message);
        } catch (e) {
          if (e?.message === "SERVER_SEND_NOT_ALLOWED") {
            await interaction.followUp({
              content:
                "전송이 막혔어요: 이 채널에서 봇이 메시지 보낼 권한이 없어요.\n" +
                "채널 권한(View Channel / Send Messages)을 확인해주세요.",
              ephemeral: true,
            });
          } else {
            const emsg = e?.rawError?.message || e?.message || String(e);
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
