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

const INTERVAL_MS = 500; // 2초 간격
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

// ✅ 채널 접근 없이도 보내지도록 followUp만 사용 (Missing Access 우회)
async function sendPublic(interaction, content) {
  return interaction.followUp({ content, ephemeral: false });
}

client.once("ready", () => {
  console.log(`로그인됨: ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  // 1) 슬래시 명령 처리
  if (interaction.isChatInputCommand()) {
    const userId = interaction.user.id;
    const channelId = interaction.channelId;

    if (interaction.commandName === "도배") {
      const userRun = getUserRunMap(userId);
      if (userRun.has(channelId)) {
        return interaction.reply({
          content: "이미 여기에서 진행 중이에요. `/도배중지`로 멈춘 뒤 다시 해줘요.",
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

  // 2) 모달 제출 처리
  if (interaction.isModalSubmit()) {
    if (interaction.customId !== "dobae_modal") return;

    const userId = interaction.user.id;
    const channelId = interaction.channelId;

    const message = (interaction.fields.getTextInputValue("dobae_message") ?? "").trim();
    const countStr = (interaction.fields.getTextInputValue("dobae_count") ?? "").trim();

    if (!message) {
      return interaction.reply({ content: "메시지를 입력해줘요.", ephemeral: true });
    }
    if (message.length > MAX_MESSAGE_LEN) {
      return interaction.reply({
        content: `메시지는 ${MAX_MESSAGE_LEN}자 이내만 가능해요.`,
        ephemeral: true,
      });
    }

    // ✅ 숫자만 허용
    if (!/^\d+$/.test(countStr)) {
      return interaction.reply({
        content: "반복 횟수는 숫자만 입력해주세요. (1~50)",
        ephemeral: true,
      });
    }

    const count = parseInt(countStr, 10);
    if (count < 1 || count > MAX_COUNT) {
      return interaction.reply({
        content: `반복 횟수는 1 ~ ${MAX_COUNT} 사이만 가능해요.`,
        ephemeral: true,
      });
    }

    const userRun = getUserRunMap(userId);
    if (userRun.has(channelId)) {
      return interaction.reply({
        content: "이미 여기에서 진행 중이에요. `/도배중지`로 멈춘 뒤 다시 해줘요.",
        ephemeral: true,
      });
    }

    const state = { stop: false };
    userRun.set(channelId, state);

    // ✅ 시작 안내는 나만 보이게
    await interaction.reply({
      content: `전송 시작! ${INTERVAL_MS / 1000}초 간격으로 ${count}번 보낼게요. (멈추려면 /도배중지)`,
      ephemeral: true,
    });

    try {
      for (let i = 0; i < count; i++) {
        const current = getUserRunMap(userId).get(channelId);
        if (!current || current.stop) break;

        await sendPublic(interaction, message);

        if (i !== count - 1) await sleep(INTERVAL_MS);
      }
    } catch (e) {
      console.error("SEND LOOP ERROR:", e?.message || e);
    } finally {
      getUserRunMap(userId).delete(channelId);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
