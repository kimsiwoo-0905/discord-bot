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

const INTERVAL_MS = 1200;
const MAX_MESSAGE_LEN = 1500;
const MAX_COUNT = 50;

const runningByUser = new Map();
const pendingModals = new Map(); // ✅ 모달 정보 저장

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

client.once("ready", () => {
  console.log(`로그인됨: ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const userId = interaction.user.id;
    const channelId = interaction.channelId;

    if (interaction.commandName === "도배") {
      const userRun = getUserRunMap(userId);
      if (userRun.has(channelId)) {
        return interaction.reply({
          content: "이미 진행 중이에요.",
          ephemeral: true,
        });
      }

      // ✅ 채널 정보 미리 저장
      pendingModals.set(userId, {
        channelId: channelId,
        guildId: interaction.guildId,
      });

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
        .setLabel("반복 횟수 (숫자만 1~50)")
        .setStyle(TextInputStyle.Short)
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
        return interaction.reply({
          content: "진행 중인 도배가 없어요.",
          ephemeral: true,
        });
      }

      for (const state of userRun.values()) {
        state.stop = true;
      }
      userRun.clear();

      return interaction.reply({
        content: "도배를 중지했어요.",
        ephemeral: true,
      });
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId !== "dobae_modal") return;

    const userId = interaction.user.id;
    
    // ✅ 저장된 채널 정보 가져오기
    const modalInfo = pendingModals.get(userId);
    if (!modalInfo) {
      return interaction.reply({
        content: "세션 정보를 찾을 수 없어요. 다시 시도해주세요.",
        ephemeral: true,
      });
    }

    const channelId = modalInfo.channelId;
    pendingModals.delete(userId);

    const message = interaction.fields.getTextInputValue("dobae_message").trim();
    const countStr = interaction.fields.getTextInputValue("dobae_count").trim();

    if (!/^\d+$/.test(countStr)) {
      return interaction.reply({
        content: "숫자만 입력해주세요.",
        ephemeral: true,
      });
    }

    const count = parseInt(countStr, 10);

    if (count < 1 || count > MAX_COUNT) {
      return interaction.reply({
        content: "1~50 사이 숫자만 가능해요.",
        ephemeral: true,
      });
    }

    const userRun = getUserRunMap(userId);
    const state = { stop: false };
    userRun.set(channelId, state);

    await interaction.reply({
      content: `도배를 시작합니다. (${count}회)`,
      ephemeral: true,
    });

    // ✅ 채널 fetch
    let channel = null;
    
    try {
      channel = await client.channels.fetch(channelId);
      console.log("채널 fetch 성공:", channel.name);
    } catch (error) {
      console.error("채널 fetch 실패:", error);
      return interaction.followUp({
        content: "채널을 찾을 수 없어요. 봇 권한을 확인해주세요.",
        ephemeral: true,
      });
    }

    let sentCount = 0;

    for (let i = 0; i < count; i++) {
      const current = getUserRunMap(userId).get(channelId);
      if (!current || current.stop) break;

      try {
        await channel.send(message);
        sentCount++;
        console.log(`전송 완료: ${sentCount}/${count}`);

        if (sentCount % 5 === 0 && i < count - 1) {
          await sleep(2000);
        } else {
          await sleep(INTERVAL_MS);
        }
      } catch (error) {
        console.error(`메시지 전송 실패 (${i + 1}/${count}):`, error);

        if (error.code === 429) {
          const retryAfter = error.retry_after || 5000;
          console.log(`Rate limit. ${retryAfter}ms 대기...`);
          await sleep(retryAfter);
          i--;
          continue;
        }

        if (error.code === 50001) {
          await interaction.followUp({
            content: "봇이 이 채널에 접근할 수 없어요. 채널 권한을 확인해주세요.",
            ephemeral: true,
          });
          break;
        }

        if (error.code === 50013) {
          await interaction.followUp({
            content: "봇에게 메시지 보내기 권한이 없어요.",
            ephemeral: true,
          });
          break;
        }

        if (i === 0) {
          await interaction.followUp({
            content: `전송 실패: ${error.message}`,
            ephemeral: true,
          });
        }
        break;
      }
    }

    userRun.delete(channelId);

    try {
      await interaction.followUp({
        content: `도배 완료! (총 ${sentCount}개 전송)`,
        ephemeral: true,
      });
    } catch (error) {
      console.log("완료 메시지 전송 실패");
    }
  }
});

client.login(process.env.DISCORD_TOKEN);