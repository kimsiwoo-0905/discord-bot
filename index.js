require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const INTERVAL_MS = 500;
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

client.once("ready", () => {
  console.log(`로그인됨: ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  // 슬래시 명령
  if (interaction.isChatInputCommand()) {
    const userId = interaction.user.id;
    const channelId = interaction.channelId;

    if (interaction.commandName === "도배") {
      const userRun = getUserRunMap(userId);
      if (userRun.has(channelId)) {
        return interaction.reply({
          content: "이미 진행 중이에요.",
          ephemeral: true,
        });
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
        .setLabel("반복 횟수 (숫자만 1~50)")
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
        return interaction.reply({
          content: "진행 중인 도배가 없어요.",
          ephemeral: true,
        });
      }

      for (const state of userRun.values()) state.stop = true;
      userRun.clear();

      return interaction.reply({
        content: "도배를 중지했어요.",
        ephemeral: true,
      });
    }
  }

  // 모달 제출
  if (interaction.isModalSubmit()) {
    if (interaction.customId !== "dobae_modal") return;

    const userId = interaction.user.id;
    const channelId = interaction.channelId;

    const message = interaction.fields.getTextInputValue("dobae_message").trim();
    const countStr = interaction.fields.getTextInputValue("dobae_count").trim();

    if (!/^\d+$/.test(countStr)) {
      return interaction.reply({
        content: "숫자만 입력해주세요.",
        ephemeral: true,
      });
    }

    const count = parseInt(countStr, 10);

    if (count < 1 || count > MAX_COUNT) {
      return interaction.reply({
        content: `1~50 사이 숫자만 가능해요.`,
        ephemeral: true,
      });
    }

    const userRun = getUserRunMap(userId);
    const state = { stop: false };
    userRun.set(channelId, state);

    // 시작 메시지는 나만 보이게
    await interaction.reply({
      content: `도배를 시작합니다.`,
      ephemeral: true,
    });

    // ✅ followUp 말고 채널에 직접 전송 (50개까지 정상)
    const channel = await interaction.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      userRun.delete(channelId);
      return;
    }

    for (let i = 0; i < count; i++) {
      const current = getUserRunMap(userId).get(channelId);
      if (!current || current.stop) break;

      try {
        await channel.send(message);
      } catch (e) {
        break;
      }

      await sleep(INTERVAL_MS);
    }

    userRun.delete(channelId);
  }
});

client.login(process.env.DISCORD_TOKEN);
