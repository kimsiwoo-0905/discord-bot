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
        .setTitle("도배 메시지 입력");

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
      // 지금 구조에서는 반복 타이머가 없어서 "중지"는 패널 제거 용도로 처리
      userMessageStore.delete(userId);

      return interaction.reply({
        content: "도배 패널을 종료했어요. 다시 하려면 /도배",
        ephemeral: true,
      });
    }
  }

  // ✅ 모달 제출 처리
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

    // 유저별로 메시지 저장
    userMessageStore.set(userId, { message });

    // 버튼 만들기 (유저별로 다른 customId)
    const sendBtn = new ButtonBuilder()
      .setCustomId(`dobae_send:${userId}`)
      .setLabel("전송")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(sendBtn);

    // 패널은 "나만 보이게"
    return interaction.reply({
      content: "버튼을 누를 때마다 메시지가 1번 전송돼요.",
      components: [row],
      ephemeral: true,
    });
  }

  // ✅ 버튼 클릭 처리
  if (interaction.isButton()) {
    const [prefix, ownerId] = interaction.customId.split(":");
    if (prefix !== "dobae_send") return;

    // 버튼은 만든 사람만 누를 수 있게
    if (interaction.user.id !== ownerId) {
      return interaction.reply({
        content: "이 버튼은 만든 사람만 사용할 수 있어요.",
        ephemeral: true,
      });
    }

    const saved = userMessageStore.get(ownerId);
    if (!saved || !saved.message) {
      return interaction.reply({
        content: "저장된 메시지가 없어요. /도배로 다시 설정해줘요.",
        ephemeral: true,
      });
    }

    // ✅ 공개 전송 (followUp 사용)
    try {
      await interaction.followUp({
        content: saved.message,
        ephemeral: false,
      });

      // 버튼 클릭에 대한 응답(나만)
      return interaction.reply({
        content: "전송 완료!",
        ephemeral: true,
      });
    } catch (e) {
      console.error("SEND ERROR:", e?.message || e);
      return interaction.reply({
        content: "전송 실패(제한/권한 문제).",
        ephemeral: true,
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
