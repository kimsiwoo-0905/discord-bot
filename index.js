require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ✅ 허용된 사용자 2명만
const ALLOWED_USER_IDS = new Set([
  "1418826793627947038",
  "1340579141770285118",
]);

const MAX_COUNT = 100;
const INTERVAL_MS = 500;      // ✅ 2초 간격 (원하면 1000으로 바꿔도 됨)
const MAX_MESSAGE_LEN = 1500;

// 유저별 마지막 실행 시간(명령 연타 방지)
const lastUsedAt = new Map(); // userId -> timestamp

// 유저별 진행 상태 (channelId 별로)
const runningByUser = new Map(); // userId -> Map(channelId, { stop: boolean })

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

async function safeSend(interaction, content) {
  // DM/서버 상관없이 채널을 확실히 가져와서 전송
  const ch =
    interaction.channel ??
    (await interaction.client.channels.fetch(interaction.channelId));

  return ch.send({ content });
}

client.once("ready", () => {
  console.log(`로그인됨: ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;

  // ✅ 화이트리스트 체크
  if (!ALLOWED_USER_IDS.has(userId)) {
    return interaction.reply({
      content: "픽셜 전용이다",
      ephemeral: true,
    });
  }

  // ✅ /도배
  if (interaction.commandName === "도배") {
    const msg = interaction.options.getString("메시지", true);
    const count = interaction.options.getInteger("개수", true);

    if (msg.length > MAX_MESSAGE_LEN) {
      return interaction.reply({
        content: `글자수 줄여라`,
        ephemeral: true,
      });
    }
    if (count < 1 || count > MAX_COUNT) {
      return interaction.reply({
        content: `너무 길다`,
        ephemeral: true,
      });
    }

    // ✅ 유저별 쿨타임(명령 연타 방지)
    const now = Date.now();
    const last = lastUsedAt.get(userId) ?? 0;
    const diff = now - last;
    if (diff < INTERVAL_MS) {
      const left = ((INTERVAL_MS - diff) / 1000).toFixed(1);
      return interaction.reply({
        content: `너무 빠르다`,
        ephemeral: true,
      });
    }
    lastUsedAt.set(userId, now);

    const channelId = interaction.channelId;
    const userRun = getUserRunMap(userId);

    if (userRun.has(channelId)) {
      return interaction.reply({
        content: "이미 하고있다",
        ephemeral: true,
      });
    }

    // 진행 상태 저장
    const state = { stop: false };
    userRun.set(channelId, state);

    await interaction.reply({
      content: `도배 시작한다`,
      ephemeral: true,
    });

    // ✅ setInterval 대신 순차 루프 (중간에 끊김 거의 없음)
    try {
      for (let i = 0; i < count; i++) {
        const current = getUserRunMap(userId).get(channelId);
        if (!current || current.stop) break;

        await safeSend(interaction, msg);

        // 마지막엔 sleep 불필요
        if (i !== count - 1) await sleep(INTERVAL_MS);
      }
    } catch (e) {
      // 필요하면 로그 확인
      console.error("[SendError]", e);
    } finally {
      // 종료 처리
      const currentMap = getUserRunMap(userId);
      currentMap.delete(channelId);
    }
  }

  // ✅ /도배중지
  if (interaction.commandName === "도배중지") {
    const userRun = getUserRunMap(userId);

    if (userRun.size === 0) {
      return interaction.reply({
        content: "이미 중지했다",
        ephemeral: true,
      });
    }

    // 이 유저가 진행 중인 전송 전부 stop
    for (const state of userRun.values()) state.stop = true;
    userRun.clear();

    return interaction.reply({
      content: "도배 중지했다",
      ephemeral: true,
    });
  }
});

client.login(process.env.DISCORD_TOKEN);
