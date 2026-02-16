require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const MAX_MESSAGE_LEN = 1500;

// 버튼 연타 방지(유저별 쿨타임)
const SEND_COOLDOWN_MS = 2000; // 2초
const lastSendAt = new Map(); // key: `${userId}:${channelId}` -> timestamp

// userId -> { message: string }
const userMessageStore = new Map();

client.once("ready", () => {
  console.log(`로그인됨: ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  // ✅ /도배, /도배중지
  if (interaction.isChatInputCommand()) {
    const userId = interaction.user.id;

    if (interaction.commandName === "도배") {
      const modal = new ModalBuilder()
        .setCustomId("dobae_modal")
        .setTitle("메시지 입력");

      const msgInput = new TextInputBuilder()
        .setCustomId("dobae_message")
        .setLabel("보낼 메시지 (1500자 이내)")
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(MAX_MESSAGE_LEN)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(msgInput));
      return interaction.showModal(modal);
    }

    if (interaction.commandName === "도배중지") {
      userMessageStore.delete(userId);
      return interaction.reply({
        content: "전송 패널을 종료했어요. 다시 하려면 /도배",
        ephemeral: true,
      });
    }
  }

  // ✅ 모달 제출
  if (interaction.isModalSubmit()) {
    if (interaction.customId !== "dobae_modal") return;

    const userId = interaction.user.id;
    const message = (interaction.fields.getTextInputValue("dobae_message") ?? "").trim();

    if (!message) {
      return interaction.reply({ content: "메시지를 입력해줘요.", ephemeral: true });
    }
    if (message.length > MAX_MESSAGE_LEN) {
      return interaction.reply({
        content: `메시지는 ${MAX_MESSAGE_LEN}자 이내만 가능해요.`,
        ephemeral: true,
      });
    }

    userMessageStore.set(userId, { message });

    const sendBtn = new ButtonBuilder()
      .setCustomId(`send_once:${userId}`)
      .setLabel("전송 (1회)")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(sendBtn);

    return interaction.reply({
      content: "버튼을 누를 때마다 1회 전송돼요. (2초 쿨타임)",
      components: [row],
      ephemeral: true,
    });
  }

  // ✅ 버튼 클릭
  if (interaction.isButton()) {
    const [kind, ownerId] = interaction.customId.split(":");
    if (kind !== "send_once") return;

    // 버튼 만든 사람만 누르게
    if (interaction.user.id !== ownerId) {
      return interaction.reply({
        content: "이 버튼은 만든 사람만 사용할 수 있어요.",
        ephemeral: true,
      });
    }

    const saved = userMessageStore.get(ownerId);
    if (!saved?.message) {
      return interaction.reply({
        content: "저장된 메시지가 없어요. /도배로 다시 설정해줘요.",
        ephemeral: true,
      });
    }

    // ✅ 버튼 인터랙션은 먼저 ACK 해야 함 (중요)
    await interaction.deferReply({ ephemeral: true });

    // ✅ 쿨타임 체크
    const channelId = interaction.channelId;
    const key = `${ownerId}:${channelId}`;
    const now = Date.now();
    const last = lastSendAt.get(key) ?? 0;

    if (now - last < SEND_COOLDOWN_MS) {
      const left = ((SEND_COOLDOWN_MS - (now - last)) / 1000).toFixed(1);
      return interaction.editReply(`너무 빨라요. ${left}초 후 다시 눌러줘요.`);
    }
    lastSendAt.set(key, now);

    // ✅ 실제 전송: 채널로 보내기 (여러 번 눌러도 계속 가능)
    try {
      if (!interaction.channel) {
        return interaction.editReply("채널 정보를 찾을 수 없어요.");
      }

      await interaction.channel.send({ content: saved.message });
      return interaction.editReply("전송 완료!");
    } catch (e) {
      const msg = e?.rawError?.message || e?.message || "Unknown error";
      console.error("SEND ERROR:", msg);
      return interaction.editReply(`전송 실패: ${msg}`);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
