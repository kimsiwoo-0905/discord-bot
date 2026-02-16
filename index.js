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

const INTERVAL_MS = 500; // 버튼 연타 방지(너무 빠르면 무시)
const MAX_MESSAGE_LEN = 1500;
const MAX_PER_SESSION = 200; // 한 세션에서 최대 전송 횟수

// userId -> Map(channelId -> state)
const runningByUser = new Map();

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
  // 1) 슬래시 명령
  if (interaction.isChatInputCommand()) {
    const userId = interaction.user.id;
    const channelId = interaction.channelId;

    if (interaction.commandName === "도배") {
      // 같은 채널에 이미 세션 있으면 막기(원하면 이 체크 삭제 가능)
      const userRun = getUserRunMap(userId);
      if (userRun.has(channelId)) {
        return interaction.reply({
          content: "이미 이 채널에서 세션이 열려 있어요. 버튼 메시지에서 종료 후 다시 열어주세요.",
          ephemeral: true,
        });
      }

      const modal = new ModalBuilder()
        .setCustomId("dobae_modal")
        .setTitle("메시지 설정");

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
      const userRun = getUserRunMap(userId);
      if (userRun.size === 0) {
        return interaction.reply({
          content: "진행 중인 세션이 없어요.",
          ephemeral: true,
        });
      }
      userRun.clear();
      return interaction.reply({
        content: "세션을 전부 종료했어요.",
        ephemeral: true,
      });
    }
  }

  // 2) 모달 제출
  if (interaction.isModalSubmit()) {
    if (interaction.customId !== "dobae_modal") return;

    const userId = interaction.user.id;
    const channelId = interaction.channelId;

    const message = interaction.fields.getTextInputValue("dobae_message").trim();
    if (!message) {
      return interaction.reply({ content: "메시지를 입력해주세요.", ephemeral: true });
    }

    const userRun = getUserRunMap(userId);

    const state = {
      message,
      lastSentAt: 0,
      sentCount: 0,
    };
    userRun.set(channelId, state);

    const sendBtn = new ButtonBuilder()
      .setCustomId(`dobae_send:${userId}:${channelId}`)
      .setLabel("전송")
      .setStyle(ButtonStyle.Primary);

    const stopBtn = new ButtonBuilder()
      .setCustomId(`dobae_stop:${userId}:${channelId}`)
      .setLabel("종료")
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(sendBtn, stopBtn);

    return interaction.reply({
      content: `✅ 설정 완료\n- 버튼을 누를 때마다 1회 전송됩니다.\n- 전송 횟수: 0/${MAX_PER_SESSION}`,
      components: [row],
      ephemeral: true,
    });
  }

  // 3) 버튼 처리
  if (interaction.isButton()) {
    const [kind, ownerId, channelId] = interaction.customId.split(":");
    if (!kind || !ownerId || !channelId) return;

    // 버튼은 설정한 본인만 누를 수 있게
    if (interaction.user.id !== ownerId) {
      return interaction.reply({ content: "이 버튼은 만든 사람만 사용할 수 있어요.", ephemeral: true });
    }

    const userRun = getUserRunMap(ownerId);
    const state = userRun.get(channelId);

    // 세션 없으면 버튼 비활성화 안내
    if (!state) {
      // ephemeral 메시지는 남아있을 수 있으니 업데이트로 정리
      try {
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("dobae_disabled_send")
            .setLabel("전송")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId("dobae_disabled_stop")
            .setLabel("종료됨")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
        );
        return interaction.update({
          content: "이 세션은 이미 종료되었어요.",
          components: [disabledRow],
        });
      } catch {
        // update 실패 시 조용히 종료
        return;
      }
    }

    // 종료 버튼
    if (kind === "dobae_stop") {
      userRun.delete(channelId);

      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("dobae_disabled_send")
          .setLabel("전송")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId("dobae_disabled_stop")
          .setLabel("종료됨")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );

      return interaction.update({
        content: "🛑 세션을 종료했어요.",
        components: [disabledRow],
      });
    }

    // 전송 버튼
    if (kind === "dobae_send") {
      const now = Date.now();

      // 너무 빠른 연타는 무시(요청하신 “너무 자주 눌렀어요” 같은 문구는 안 띄움)
      if (now - state.lastSentAt < INTERVAL_MS) {
        return interaction.deferUpdate();
      }

      if (state.sentCount >= MAX_PER_SESSION) {
        userRun.delete(channelId);

        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("dobae_disabled_send")
            .setLabel("한도 도달")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId("dobae_disabled_stop")
            .setLabel("종료됨")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
        );

        return interaction.update({
          content: `🛑 세션 최대 전송 횟수(${MAX_PER_SESSION})에 도달해서 종료했어요.`,
          components: [disabledRow],
        });
      }

      state.lastSentAt = now;

      // 실제 메시지 전송(권한 문제면 catch)
      try {
        await interaction.channel.send(state.message);
        state.sentCount += 1;
      } catch (e) {
        // 권한/제한 문제면 세션 종료
        userRun.delete(channelId);
        return interaction.update({
          content: "❌ 전송 실패(권한/채널 제한/봇 권한 문제). 세션을 종료했어요.",
          components: [],
        });
      }

      // 버튼 메시지(에페메랄) 카운트 업데이트
      const row = interaction.message.components?.[0];
      return interaction.update({
        content: `✅ 전송됨\n- 전송 횟수: ${state.sentCount}/${MAX_PER_SESSION}`,
        components: row ? [row] : [],
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
