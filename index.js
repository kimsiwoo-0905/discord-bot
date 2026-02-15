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

const MAX_COUNT = 50;
const INTERVAL_MS = 500;     // ✅ 2초 간격
const MAX_MESSAGE_LEN = 1500;

// 유저별 마지막 실행 시간(연타 방지)
const lastUsedAt = new Map();        // userId -> timestamp(ms)

// 유저별 진행 중 작업(여러 채널/DM에서 동시에 돌릴 수 있으니 channelId로 구분)
const runningByUser = new Map();     // userId -> Map(channelId, { timer, interactionToken })

function getUserRunningMap(userId) {
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
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;

  // ✅ 화이트리스트 체크
  if (!ALLOWED_USER_IDS.has(userId)) {
    return interaction.reply({
      content: "픽셜전용이다",
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
        content: `개수는 50이 최대다`,
        ephemeral: true,
      });
    }

    // 유저별 쿨타임(명령 연타 방지)
    const now = Date.now();
    const last = lastUsedAt.get(userId) ?? 0;
    const diff = now - last;
    if (diff < INTERVAL_MS) {
      const left = ((INTERVAL_MS - diff) / 1000).toFixed(1);
      return interaction.reply({
        content: `천천히 해라`,
        ephemeral: true,
      });
    }
    lastUsedAt.set(userId, now);

    const channelId = interaction.channelId;
    const userRun = getUserRunningMap(userId);

    // 같은 채널(또는 DM)에서 이미 돌고 있으면 막기
    if (userRun.has(channelId)) {
      return interaction.reply({
        content: "이미 도배하고있다",
        ephemeral: true,
      });
    }

    // 시작 안내(서버에서는 ephemeral로 보이고, DM에서는 그냥 보일 수 있음)
    await interaction.reply({
      content: `도배 시작한다`,
      ephemeral: true,
    });

    let remaining = count;

    const timer = setInterval(async () => {
      try {
        const current = getUserRunningMap(userId);
        if (!current.has(channelId)) return;

        if (remaining <= 0) {
          clearInterval(timer);
          current.delete(channelId);
          return;
        }

        remaining -= 1;

        // ✅ DM에서도 안정적으로 전송되게 followUp 사용
        await interaction.followUp({ content: msg });
      } catch (e) {
        clearInterval(timer);
        getUserRunningMap(userId).delete(channelId);
      }
    }, INTERVAL_MS);

    userRun.set(channelId, { timer });
  }

  // ✅ /도배중지 (본인이 돌리는 전송 전부 중지)
  if (interaction.commandName === "도배중지") {
    const userRun = getUserRunningMap(userId);

    if (userRun.size === 0) {
      return interaction.reply({
        content: "도배 안하고있다",
        ephemeral: true,
      });
    }

    for (const { timer } of userRun.values()) {
      clearInterval(timer);
    }
    userRun.clear();

    return interaction.reply({
      content: "도배중지",
      ephemeral: true,
    });
  }
});

client.login(process.env.DISCORD_TOKEN);
