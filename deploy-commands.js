require("dotenv").config();
const { REST, Routes } = require("discord.js");

// contexts: 0=GUILD, 1=BOT_DM, 2=PRIVATE_CHANNEL
// integration_types: 0=GUILD_INSTALL, 1=USER_INSTALL
const commands = [
  {
    name: "도배",
    description: "도배한다",
    type: 1,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      { name: "메시지", description: "보낼 내용", type: 3, required: true },
      { name: "개수", description: "반복 횟수 (최대 20)", type: 4, required: true },
    ],
  },
  {
    name: "도배중지",
    description: "도배 멈춘다",
    type: 1,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("전역(글로벌) 커맨드 등록 중...");
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log("완료!");
  } catch (e) {
    console.error(e);
  }
})();
