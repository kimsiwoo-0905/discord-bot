require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ChannelType,
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
});

const INTERVAL_MS = 500;
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

/**
 * ✅ 반복 전송은 "채널 메시지 send"로만 보냄 (followUp 제한 회피)
 * - 서버: interaction.channel.send()
 * - DM: user.createDM()로 DM 채널 만든 뒤 send()
 */
async function sendByChannel(interaction, content) {
  // 1) DM이면: 사용자 DM 채널로 보내기
  if (interaction.channel?.type === ChannelType.DM) {
    const dm = await interaction.user.createDM();
    return dm.send({ content });
  }

  // 2) 서버/기타면: 현재 채널로 보내기
  if (interaction.channel) {
    return interaction.channel.send({ content });
  }

  // 3) 혹시 channel 객체가 없으면 fetch 후 send
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
        return interaction.reply({ content: "진행 중입니다.", ephemeral: true });
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

    const state = { stop: false };
    userRun.set(channelId, state);

    // ✅ 시작 안내는 followUp 제한 안 걸리게 reply 1번만(나만)
    await interaction.reply({ content: `도배를 시작합니다.`, ephemeral: true });

    try {
      for (let i = 0; i < count; i++) {
        const current = getUserRunMap(userId).get(channelId);
        if (!current || current.stop) break;

        try {
          console.log(`[SEND] ${i + 1}/${count} channel=${channelId}`);
          await sendByChannel(interaction, message);
        } catch (e) {
          const emsg = e?.rawError?.message || e?.message || String(e);
          console.error("SEND ERROR:", emsg);

          // 에러 안내는 1번만(나만)
          try {
            await interaction.followUp({ content: `에러111`, ephemeral: true });
          } catch {}
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
