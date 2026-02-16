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
  PermissionsBitField,
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// 안전장치
const COOLDOWN_MS = 10_000;     // 10초 쿨타임
const MAX_PER_SESSION = 5;      // 세션당 최대 5회만
const MAX_MESSAGE_LEN = 1500;

const sessions = new Map(); // key: `${userId}:${channelId}` -> { message, lastAt, count }

client.once("ready", () => {
  console.log(`로그인됨: ${client.user.tag}`);
});

function keyOf(userId, channelId) {
  return `${userId}:${channelId}`;
}

client.on("interactionCreate", async (interaction) => {
  // 슬래시 명령: /테스트전송
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName !== "테스트전송") return;

    const modal = new ModalBuilder()
      .setCustomId("one_send_modal")
      .setTitle("전송 테스트");

    const msgInput = new TextInputBuilder()
      .setCustomId("one_send_message")
      .setLabel("보낼 메시지 (1500자 이내)")
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(MAX_MESSAGE_LEN)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(msgInput));
    return interaction.showModal(modal);
  }

  // 모달 제출
  if (interaction.isModalSubmit()) {
    if (interaction.customId !== "one_send_modal") return;

    const userId = interaction.user.id;
    const channelId = interaction.channelId;

    const message = interaction.fields.getTextInputValue("one_send_message").trim();
    if (!message) {
      return interaction.reply({ content: "메시지를 입력해주세요.", ephemeral: true });
    }

    // 세션 저장
    sessions.set(keyOf(userId, channelId), {
      message,
      lastAt: 0,
      count: 0,
    });

    const sendBtn = new ButtonBuilder()
      .setCustomId(`one_send:${userId}:${channelId}`)
      .setLabel("1회 전송")
      .setStyle(ButtonStyle.Primary);

    const endBtn = new ButtonBuilder()
      .setCustomId(`one_end:${userId}:${channelId}`)
      .setLabel("종료")
      .setStyle(ButtonStyle.Danger);

    return interaction.reply({
      content:
        "✅ 준비 완료\n" +
        `- 1회 전송 버튼을 누르면 한 번만 전송을 시도합니다.\n` +
        `- 쿨타임: ${COOLDOWN_MS / 1000}s, 세션 최대: ${MAX_PER_SESSION}회`,
      components: [new ActionRowBuilder().addComponents(sendBtn, endBtn)],
      ephemeral: true,
    });
  }

  // 버튼
  if (interaction.isButton()) {
    const parts = interaction.customId.split(":");
    const kind = parts[0];
    const ownerId = parts[1];
    const channelId = parts[2];

    if (!kind || !ownerId || !channelId) return;

    // 본인만 사용
    if (interaction.user.id !== ownerId) {
      return interaction.reply({ content: "이 버튼은 만든 사람만 사용할 수 있어요.", ephemeral: true });
    }

    const k = keyOf(ownerId, channelId);
    const state = sessions.get(k);

    if (!state) {
      return interaction.update({ content: "세션이 없거나 이미 종료됐어요.", components: [] });
    }

    if (kind === "one_end") {
      sessions.delete(k);
      return interaction.update({ content: "🛑 세션 종료", components: [] });
    }

    if (kind !== "one_send") return;

    const now = Date.now();

    // 쿨타임
    if (now - state.lastAt < COOLDOWN_MS) {
      return interaction.reply({
        content: `⏳ 너무 빨라요. ${(COOLDOWN_MS - (now - state.lastAt)) / 1000}s 뒤에 다시 눌러주세요.`,
        ephemeral: true,
      });
    }

    // 세션 최대 횟수
    if (state.count >= MAX_PER_SESSION) {
      sessions.delete(k);
      return interaction.update({
        content: `🛑 세션 최대 전송 횟수(${MAX_PER_SESSION}) 도달로 종료`,
        components: [],
      });
    }

    state.lastAt = now;

    try {
      // 채널 fetch
      const ch = await client.channels.fetch(channelId);

      if (!ch || !ch.isTextBased()) {
        sessions.delete(k);
        return interaction.update({
          content: "❌ 이 채널은 텍스트 채널이 아니라서 전송할 수 없어요.",
          components: [],
        });
      }

      // 권한 진단(길드 채널일 때만 의미 있음)
      if (interaction.guild && "permissionsFor" in ch) {
        const me = interaction.guild.members.me;
        if (me) {
          const perms = ch.permissionsFor(me);
          const need = [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
          ];

          const missing = need.filter((p) => !perms?.has(p));
          if (missing.length) {
            sessions.delete(k);
            return interaction.update({
              content:
                "❌ 권한 부족으로 전송 불가\n" +
                `- 필요한 권한: ViewChannel, SendMessages\n` +
                `- 현재 누락: ${missing.map(String).join(", ")}`,
              components: [],
            });
          }
        }
      }

      await ch.send(state.message);
      state.count += 1;

      return interaction.update({
        content: `✅ 전송 성공 (${state.count}/${MAX_PER_SESSION})`,
        components: interaction.message.components,
      });
    } catch (e) {
      sessions.delete(k);
      return interaction.update({
        content: `❌ 전송 실패\n에러: ${e?.message || String(e)}`,
        components: [],
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
