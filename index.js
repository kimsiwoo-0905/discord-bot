require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  PermissionsBitField,
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const INTERVAL_MS = 2000; // 2초 간격
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
 * ✅ 가능한 경우: channel.send() (가장 안정)
 * ❌ 안 되면: interaction.followUp() fallback
 * - followUp이 중간에 막히면 ok:false로 반환해서 루프를 멈추고 이유를 표시
 */
async function sendSmart(interaction, content) {
  // 1) 서버에서 봇이 "멤버"로 있고, 채널에 전송 권한이 있으면 channel.send 시도
  try {
    if (interaction.guild && interaction.channel && interaction.guild.members?.me) {
      const me = interaction.guild.members.me;
      const perms = interaction.channel.permissionsFor(me);
      if (perms?.has(PermissionsBitField.Flags.SendMessages)) {
        const res = await interaction.channel.send({ content });
        return { ok: true, via: "channel", res };
      }
    }
  } catch (e) {
    // ignore and fallback
  }

  // 2) fallback: followUp
  try {
    const res = await interaction.followUp({ content, ephemeral: false });
    return { ok: true, via: "followUp", res };
  } catch (e) {
    return { ok: false, via: "followUp", err: e };
  }
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
        return interaction.reply({
          content: "진행 중입니다.",
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

  // 2) 모달 제출
  if (interaction.isModalSubmit()) {
    if (interaction.customId !== "dobae_modal") return;

    const userId = interaction.user.id;
    const channelId = interaction.channelId;

    const message = (interaction.fields.getTextInputValue("dobae_message") ?? "").trim();
    const countStr = (interaction.fields.getTextInputValue("dobae_count") ?? "").trim();

    if (!message) {
      return interaction.reply({ content: "메시지를 입력해주세요.", ephemeral: true });
    }
    if (message.length > MAX_MESSAGE_LEN) {
      return interaction.reply({
        content: `메시지는 1500자 이내만 가능해요.`,
        ephemeral: true,
      });
    }

    // 숫자만 허용
    if (!/^\d+$/.test(countStr)) {
      return interaction.reply({
        content: "반복 횟수는 숫자만 입력해주세요. (1~50)",
        ephemeral: true,
      });
    }

    const count = parseInt(countStr, 10);
    if (count < 1 || count > MAX_COUNT) {
      return interaction.reply({
        content: "반복 횟수는 1~50 사이만 가능해요.",
        ephemeral: true,
      });
    }

    const userRun = getUserRunMap(userId);
    if (userRun.has(channelId)) {
      return interaction.reply({
        content: "이미 진행 중 입니다.",
        ephemeral: true,
      });
    }

    const state = { stop: false };
    userRun.set(channelId, state);

    await interaction.reply({
      content: "도배를 시작합니다.",
      ephemeral: true,
    });

    try {
      for (let i = 0; i < count; i++) {
        const current = getUserRunMap(userId).get(channelId);
        if (!current || current.stop) break;

        console.log(`[SEND] ${i + 1}/${count} channel=${channelId}`);

        const result = await sendSmart(interaction, message);

        if (!result.ok) {
          const emsg =
            result.err?.rawError?.message ||
            result.err?.message ||
            String(result.err);

          console.error("SEND ERROR:", emsg);

          // 사용자에게도 이유 표시(나만 보이게)
          try {
            await interaction.followUp({
              content: `에러`,
              ephemeral: true,
            });
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
