require("dotenv").config();
const { Client, GatewayIntentBits, PermissionsBitField } = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const MAX_COUNT = 50;
const INTERVAL_MS = 500;      
const USER_COOLDOWN = 500; 
const MAX_MESSAGE_LEN = 1500;

const lastUsed = new Map(); // userId -> timestamp
const running = new Map();  // channelId -> { stop: boolean }

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeSend(interaction, content) {
  // 채널 확보 (interaction.channel이 null일 수 있음)
  const channel =
    interaction.channel ??
    (await interaction.client.channels.fetch(interaction.channelId).catch(() => null));

  if (!channel || typeof channel.isTextBased !== "function" || !channel.isTextBased()) {
    throw new Error("이 채널에서는 메시지를 보낼 수 없어요.");
  }

  // 길드 내에서만 권한 체크
  if (interaction.inGuild()) {
    // ✅ 캐시 없어도 안전하게 봇 멤버 가져오기
    const me = await interaction.guild.members.fetchMe().catch(() => null);
    if (!me) throw new Error("에러");

    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionsBitField.Flags.ViewChannel)) {
      throw new Error("봇에게 권한이 없어요.");
    }
    if (!perms?.has(PermissionsBitField.Flags.SendMessages)) {
      throw new Error("봇에게 권한이 없어요.");
    }

    // 스레드면 스레드 전송 권한도 확인
    if (typeof channel.isThread === "function" && channel.isThread()) {
      if (!perms?.has(PermissionsBitField.Flags.SendMessagesInThreads)) {
        throw new Error("봇에게 권한이 없어요.");
      }
    }
  }

  return channel.send({
    content,
    allowedMentions: {
      parse: ["users", "roles", "everyone"], // 모든 멘션 허용 (원치 않으면 여기서 줄이면 됨)
      repliedUser: true,
    },
  });
}

client.once("ready", () => {
  console.log(`로그인됨: ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // ✅ 관리자/메시지관리 권한 제한 제거
  // => 이제 "앱 명령어 권한(Integrations > Commands)"만 있으면 사용 가능

  if (interaction.commandName === "도배") {
    const msg = interaction.options.getString("메시지", true);
    const count = interaction.options.getInteger("개수", true);

    if (msg.length > MAX_MESSAGE_LEN) {
      return interaction.reply({ content: "1500자 이하로 적어주세요.", ephemeral: true });
    }
    if (count < 1 || count > MAX_COUNT) {
      return interaction.reply({ content: "1~50 사이로 적어주세요.", ephemeral: true });
    }

    // 유저 쿨타임
    const now = Date.now();
    const last = lastUsed.get(interaction.user.id) ?? 0;
    const leftMs = USER_COOLDOWN - (now - last);
    if (leftMs > 0) {
      const leftSec = Math.ceil(leftMs / 1000);
      return interaction.reply({ content: `너무 빠릅니다.`, ephemeral: true });
    }
    lastUsed.set(interaction.user.id, now);

    const channelId = interaction.channelId;

    if (running.has(channelId)) {
      return interaction.reply({ content: "이미 실행 중 입니다.", ephemeral: true });
    }

    const state = { stop: false };
    running.set(channelId, state);

    await interaction.reply({ content: "도배 시작", ephemeral: true });

    try {
      for (let i = 0; i < count; i++) {
        if (state.stop) break;

        await safeSend(interaction, msg);
        if (i !== count - 1) await sleep(INTERVAL_MS);
      }
    } catch (err) {
      console.error("[SendError]", err);
      await interaction.followUp({
        content: `전송 실패: ${err?.message ?? String(err)}`,
        ephemeral: true,
      });
    } finally {
      running.delete(channelId);
    }
    return;
  }

  if (interaction.commandName === "도배중지") {
    const state = running.get(interaction.channelId);

    if (!state) {
      return interaction.reply({ content: "진행 중인 도배가 없어요.", ephemeral: true });
    }

    // ✅ stop만 true로 바꾸면 루프가 다음 반복 전에 멈춤
    state.stop = true;

    return interaction.reply({ content: "도배를 중지했어요.", ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);