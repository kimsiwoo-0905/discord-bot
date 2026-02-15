require("dotenv").config();
const { REST, Routes } = require("discord.js");

// contexts: 0=GUILD, 1=BOT_DM, 2=PRIVATE_CHANNEL
// integration_types: 0=GUILD_INSTALL, 1=USER_INSTALL
const commands = [
  {
    name: "도배",
    description: "메시지를 반복 전송합니다",
    type: 1,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "도배중지",
    description: "진행 중인 도배를 중지합니다",
    type: 1,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("전역 슬래시 명령어 등록 중...");
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log("명령어 등록 완료!");
  } catch (e) {
    console.error(e);
  }
})();
