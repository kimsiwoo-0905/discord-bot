require("dotenv").config();
const { Client, GatewayIntentBits, PermissionsBitField } = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const MAX_COUNT = 50;
const INTERVAL_MS = 500;
const USER_COOLDOWN = 500;
const MAX_MESSAGE_LEN = 1500;

const lastUsed = new Map();
const running = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeSend(interaction, content) {
  const channel =
    interaction.channel ??
    (await interaction.client.channels.fetch(interaction.channelId).catch(() => null));

  // send 함수가 없는 채널이면 전송 불가 (포럼 목록, 음성채널 등)
  if (!channel || typeof channel.send !== "function") {
    throw new Error("텍스트 채널이나 스레드 안에서 실행해주세요.");
  }

  // 길드에서만 권한 체크
  if (interaction.inGuild()) {
    const me = await interaction.guild.members.fetchMe().catch(() => null);
    if (!me) throw new Error("봇 정보를 불러올 수 없습니다.");

    const perms = channel.permissionsFor?.(me);

    if (perms) {
      if (!perms.has(PermissionsBitField.Flags.ViewChannel)) {
        throw new Error("봇에게 채널 보기 권한이 없습니다.");
      }
      if (!perms.has(PermissionsBitField.Flags.SendMessages)) {
        throw new Error("봇에게 메시지 전송 권한이 없습니다.");
      }

      // 스레드일 경우 추가 체크
      if (typeof channel.isThread === "function" && channel.isThread()) {
        if (!perms.has(PermissionsBitField.Flags.SendMessagesInThreads)) {
          throw new Error("봇에게 스레드 전송 권한이 없습니다.");
        }
      }
    }
  }

  return channel.send({
    content,
    allowedMentions: {
      parse: ["users", "roles", "everyone"],
      repliedUser: true,
    },
  });
}

client.once("ready", () => {
  console.log(`로그인됨: ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // -------------------------
  // /도배
  // -------------------------
  if (interaction.commandName === "도배") {
    const msg = interaction.options.getString("메시지", true);
    const count = interaction.options.getInteger("개수", true);

    if (msg.length > MAX_MESSAGE_LEN) {
      return interaction.reply({
        content: "1500자 이하로 적어주세요.",
        ephemeral: true,
      });
    }

    if (count < 1 || count > MAX_COUNT) {
      return interaction.reply({
        content: `1~${MAX_COUNT} 사이로 적어주세요.`,
        ephemeral: true,
      });
    }

    // 쿨타임 체크
    const now = Date.now();
    const last = lastUsed.get(interaction.user.id) ?? 0;
    const leftMs = USER_COOLDOWN - (now - last);

    if (leftMs > 0) {
      return interaction.reply({
        content: "너무 빠릅니다.",
        ephemeral: true,
      });
    }

    lastUsed.set(interaction.user.id, now);

    const channelId = interaction.channelId;

    if (running.has(channelId)) {
      return interaction.reply({
        content: "이미 실행 중 입니다.",
        ephemeral: true,
      });
    }

    const state = { stop: false };
    running.set(channelId, state);

    await interaction.reply({
      content: "도배 시작",
      ephemeral: true,
    });

    try {
      for (let i = 0; i < count; i++) {
        if (state.stop) break;

        try {
          await safeSend(interaction, msg);
        } catch (err) {
          console.error("[SendError]", err.message);
          await interaction.followUp({
            content: `전송 실패: ${err.message}`,
            ephemeral: true,
          });
          break;
        }

        if (i !== count - 1) await sleep(INTERVAL_MS);
      }
    } finally {
      running.delete(channelId);
    }

    return;
  }

  // -------------------------
  // /도배중지
  // -------------------------
  if (interaction.commandName === "도배중지") {
    const state = running.get(interaction.channelId);

    if (!state) {
      return interaction.reply({
        content: "진행 중인 도배가 없어요.",
        ephemeral: true,
      });
    }

    state.stop = true;

    return interaction.reply({
      content: "도배를 중지했어요.",
      ephemeral: true,
    });
  }
});

client.login(process.env.DISCORD_TOKEN);
