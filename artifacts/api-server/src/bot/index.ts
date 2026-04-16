import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  GuildMember,
  Message,
} from "discord.js";
import { logger } from "../lib/logger";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  initMusic,
  addToQueue,
  stopMusic,
  skipTrack,
  pauseMusic,
  resumeMusic,
  toggleLoop,
  getNowPlaying,
  getQueueList,
  isLooping,
  removeFromQueue,
} from "./music";

const chatModeChannels = new Set<string>();

const conversationHistory = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();

interface Warning {
  reason: string;
  moderator: string;
  timestamp: number;
}

const warnings = new Map<string, Map<string, Warning[]>>();

function getUserWarnings(guildId: string, userId: string): Warning[] {
  if (!warnings.has(guildId)) warnings.set(guildId, new Map());
  const guildWarns = warnings.get(guildId)!;
  if (!guildWarns.has(userId)) guildWarns.set(userId, []);
  return guildWarns.get(userId)!;
}

function addWarning(guildId: string, userId: string, warn: Warning) {
  const list = getUserWarnings(guildId, userId);
  list.push(warn);
}

function clearWarnings(guildId: string, userId: string) {
  warnings.get(guildId)?.set(userId, []);
}

interface SayLog {
  userId: string;
  userTag: string;
  content: string;
  channelId: string;
  timestamp: number;
}

const sayLog = new Map<string, SayLog>();

function isAdminOrOwner(member: GuildMember, guild: import("discord.js").Guild): boolean {
  return (
    member.id === guild.ownerId ||
    member.permissions.has(PermissionFlagsBits.Administrator)
  );
}

const token = process.env["DISCORD_BOT_TOKEN"];
if (!token) {
  throw new Error("DISCORD_BOT_TOKEN is required but not set.");
}

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.GuildMember],
});

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Проверить задержку бота"),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Показать список всех команд"),

  new SlashCommandBuilder()
    .setName("info")
    .setDescription("Информация о сервере"),

  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Задать вопрос ИИ")
    .addStringOption((opt) =>
      opt
        .setName("вопрос")
        .setDescription("Твой вопрос")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Забанить пользователя")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((opt) =>
      opt.setName("пользователь").setDescription("Кого забанить").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("причина").setDescription("Причина бана").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Замьютить пользователя (тайм-аут)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) =>
      opt.setName("пользователь").setDescription("Кого замьютить").setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("минуты")
        .setDescription("На сколько минут (макс 40320 = 4 недели)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320)
    )
    .addStringOption((opt) =>
      opt.setName("причина").setDescription("Причина мута").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("Снять мут с пользователя")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) =>
      opt.setName("пользователь").setDescription("У кого снять мут").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Кикнуть пользователя")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((opt) =>
      opt.setName("пользователь").setDescription("Кого кикнуть").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("причина").setDescription("Причина кика").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Удалить сообщения в канале")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((opt) =>
      opt
        .setName("количество")
        .setDescription("Сколько сообщений удалить (1-100)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    ),

  new SlashCommandBuilder()
    .setName("role")
    .setDescription("Выдать или снять роль у пользователя")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption((opt) =>
      opt.setName("пользователь").setDescription("Пользователь").setRequired(true)
    )
    .addRoleOption((opt) =>
      opt.setName("роль").setDescription("Роль для выдачи/снятия").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("chat")
    .setDescription("Включить или выключить режим общения с ИИ в этом канале")
    .addSubcommand((sub) =>
      sub.setName("on").setDescription("Включить режим чата с ИИ")
    )
    .addSubcommand((sub) =>
      sub.setName("off").setDescription("Выключить режим чата с ИИ")
    ),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Выдать предупреждение пользователю")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) =>
      opt.setName("пользователь").setDescription("Кому выдать варн").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("причина").setDescription("Причина предупреждения").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("Посмотреть предупреждения пользователя")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) =>
      opt.setName("пользователь").setDescription("Чьи варны посмотреть").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("clearwarns")
    .setDescription("Сбросить все предупреждения пользователя")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) =>
      opt.setName("пользователь").setDescription("У кого сбросить варны").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Включить музыку в голосовом канале")
    .addStringOption((opt) =>
      opt.setName("запрос").setDescription("Название трека или YouTube-ссылка").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Остановить музыку и выйти из канала"),

  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Пропустить текущий трек"),

  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Показать очередь треков"),

  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Поставить музыку на паузу"),

  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Продолжить воспроизведение"),

  new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Показать информацию о текущем треке"),

  new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Включить/выключить повтор текущего трека"),

  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Удалить трек из очереди")
    .addIntegerOption((opt) =>
      opt.setName("номер").setDescription("Номер трека в очереди").setRequired(true).setMinValue(2)
    ),

  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Отправить сообщение от лица бота (только для овнера и админов)")
    .addStringOption((opt) =>
      opt.setName("текст").setDescription("Текст сообщения").setRequired(true)
    )
    .addChannelOption((opt) =>
      opt.setName("канал").setDescription("Канал для отправки (по умолчанию текущий)").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("whosaid")
    .setDescription("Узнать кто написал сообщение через /say (только для овнера и админов)")
    .addStringOption((opt) =>
      opt.setName("id").setDescription("ID сообщения (правая кнопка → Скопировать ID)").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("8ball")
    .setDescription("Спроси магический шар")
    .addStringOption((opt) =>
      opt.setName("вопрос").setDescription("Твой вопрос").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("coinflip")
    .setDescription("Подбросить монетку — орёл или решка"),

  new SlashCommandBuilder()
    .setName("dice")
    .setDescription("Бросить кубик")
    .addIntegerOption((opt) =>
      opt
        .setName("стороны")
        .setDescription("Количество сторон кубика (по умолчанию 6)")
        .setRequired(false)
        .setMinValue(2)
        .setMaxValue(1000)
    ),

  new SlashCommandBuilder()
    .setName("joke")
    .setDescription("Случайная шутка"),

  new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Создать голосование")
    .addStringOption((opt) =>
      opt.setName("вопрос").setDescription("Вопрос для голосования").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("варианты").setDescription("Варианты через запятую (макс 9), например: Да, Нет, Не знаю").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Показать аватар пользователя")
    .addUserOption((opt) =>
      opt.setName("пользователь").setDescription("Чей аватар показать (по умолчанию твой)").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("remind")
    .setDescription("Установить напоминание")
    .addIntegerOption((opt) =>
      opt.setName("минуты").setDescription("Через сколько минут напомнить").setRequired(true).setMinValue(1).setMaxValue(1440)
    )
    .addStringOption((opt) =>
      opt.setName("текст").setDescription("О чём напомнить").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("serverinfo")
    .setDescription("Информация о сервере"),

  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Информация о пользователе")
    .addUserOption((opt) =>
      opt.setName("пользователь").setDescription("Чью информацию показать (по умолчанию твою)").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("roll")
    .setDescription("Случайное число в диапазоне")
    .addIntegerOption((opt) =>
      opt.setName("мин").setDescription("Минимальное значение (по умолчанию 1)").setRequired(false).setMinValue(0)
    )
    .addIntegerOption((opt) =>
      opt.setName("макс").setDescription("Максимальное значение (по умолчанию 100)").setRequired(false).setMaxValue(1000000)
    ),

  new SlashCommandBuilder()
    .setName("hug")
    .setDescription("Обнять пользователя 🤗")
    .addUserOption((opt) =>
      opt.setName("пользователь").setDescription("Кого обнять").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ship")
    .setDescription("Узнать совместимость двух пользователей 💘")
    .addUserOption((opt) =>
      opt.setName("пользователь1").setDescription("Первый пользователь").setRequired(true)
    )
    .addUserOption((opt) =>
      opt.setName("пользователь2").setDescription("Второй пользователь").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Установить медленный режим в канале (только для админов)")
    .addIntegerOption((opt) =>
      opt.setName("секунды").setDescription("Задержка в секундах (0 — выключить)").setRequired(true).setMinValue(0).setMaxValue(21600)
    ),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Закрыть канал для отправки сообщений (только для админов)"),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Открыть канал для отправки сообщений (только для админов)"),

  new SlashCommandBuilder()
    .setName("nickname")
    .setDescription("Сменить никнейм пользователя (только для админов)")
    .addUserOption((opt) =>
      opt.setName("пользователь").setDescription("Кому менять никнейм").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("никнейм").setDescription("Новый никнейм (пусто — сбросить)").setRequired(false).setMaxLength(32)
    ),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Отправить объявление в канал (только для админов)")
    .addStringOption((opt) =>
      opt.setName("текст").setDescription("Текст объявления").setRequired(true)
    )
    .addChannelOption((opt) =>
      opt.setName("канал").setDescription("Куда отправить (по умолчанию текущий канал)").setRequired(false)
    ),
];

async function registerCommands(guildId: string) {
  const rest = new REST({ version: "10" }).setToken(token!);
  const clientId = client.user!.id;
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: commands.map((c) => c.toJSON()),
  });
  logger.info({ guildId }, "Slash commands registered");
}

client.once("ready", async () => {
  initMusic(client);
  logger.info({ tag: client.user?.tag }, "Discord bot ready");
  for (const guild of client.guilds.cache.values()) {
    try {
      await registerCommands(guild.id);
    } catch (err) {
      logger.error({ err, guildId: guild.id }, "Failed to register commands");
    }
  }
});

client.on("guildCreate", async (guild) => {
  try {
    await registerCommands(guild.id);
  } catch (err) {
    logger.error({ err, guildId: guild.id }, "Failed to register commands on join");
  }
});

client.on("guildMemberAdd", async (member) => {
  try {
    const channel = member.guild.systemChannel;
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("Добро пожаловать! 🎉")
      .setDescription(
        `Привет, ${member}! Рады видеть тебя на сервере **${member.guild.name}**.\nПосмотри правила и наслаждайся!`
      )
      .setThumbnail(member.user.displayAvatarURL())
      .setFooter({ text: `Участник #${member.guild.memberCount}` })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "Failed to send welcome message");
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
    if (commandName === "ping") {
      const latency = Date.now() - interaction.createdTimestamp;
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle("🏓 Понг!")
            .addFields(
              { name: "Задержка бота", value: `${latency}мс`, inline: true },
              { name: "API задержка", value: `${Math.round(client.ws.ping)}мс`, inline: true }
            ),
        ],
      });
    }

    else if (commandName === "help") {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("📖 Список команд")
            .addFields(
              { name: "/ping", value: "Проверить задержку бота", inline: false },
              { name: "/help", value: "Показать этот список", inline: false },
              { name: "/info", value: "Информация о сервере", inline: false },
              { name: "/ask <вопрос>", value: "Задать вопрос ИИ", inline: false },
              { name: "/ban <пользователь> [причина]", value: "Забанить участника (требует право Ban Members)", inline: false },
              { name: "/kick <пользователь> [причина]", value: "Кикнуть участника (требует право Kick Members)", inline: false },
              { name: "/mute <пользователь> <минуты> [причина]", value: "Замьютить участника (требует право Moderate Members)", inline: false },
              { name: "/unmute <пользователь>", value: "Снять мут (требует право Moderate Members)", inline: false },
              { name: "/purge <количество>", value: "Удалить сообщения (требует право Manage Messages)", inline: false },
              { name: "/role <пользователь> <роль>", value: "Выдать/снять роль (требует право Manage Roles)", inline: false },
              { name: "/chat on / off", value: "Включить/выключить режим чата с ИИ в канале", inline: false },
              { name: "/warn · /warnings · /clearwarns", value: "Система предупреждений", inline: false },
              { name: "/say <текст> [канал]", value: "Написать от лица бота (овнер и администраторы)", inline: false },
              { name: "/whosaid <id>", value: "Узнать кто написал через /say (овнер и администраторы)", inline: false },
              { name: "─── 🎵 Музыка (для всех) ───", value: "\u200b", inline: false },
              { name: "/play <запрос>", value: "Включить музыку по названию или YouTube-ссылке", inline: false },
              { name: "/stop", value: "Остановить музыку и выйти из канала", inline: false },
              { name: "/skip", value: "Пропустить текущий трек", inline: false },
              { name: "/queue", value: "Показать очередь треков", inline: false },
              { name: "/pause / /resume", value: "Пауза / Продолжить воспроизведение", inline: false },
              { name: "/nowplaying", value: "Информация о текущем треке", inline: false },
              { name: "/loop", value: "Включить/выключить повтор трека", inline: false },
              { name: "/remove <номер>", value: "Удалить трек из очереди", inline: false },
              { name: "─── 📊 Информация (для всех) ───", value: "\u200b", inline: false },
              { name: "/serverinfo", value: "Статистика сервера", inline: false },
              { name: "/userinfo [пользователь]", value: "Профиль участника", inline: false },
              { name: "/avatar [пользователь]", value: "Показать аватар", inline: false },
              { name: "─── 🎉 Фан-команды (для всех) ───", value: "\u200b", inline: false },
              { name: "/8ball <вопрос>", value: "Магический шар предсказаний", inline: false },
              { name: "/coinflip", value: "Орёл или решка", inline: false },
              { name: "/dice [стороны]", value: "Бросить кубик", inline: false },
              { name: "/roll [мин] [макс]", value: "Случайное число в диапазоне", inline: false },
              { name: "/hug <пользователь>", value: "Обнять участника 🤗", inline: false },
              { name: "/ship <пользователь1> [пользователь2]", value: "Тест совместимости 💘", inline: false },
              { name: "/joke", value: "Случайная шутка", inline: false },
              { name: "/poll <вопрос> <варианты>", value: "Создать голосование с реакциями", inline: false },
              { name: "/remind <минуты> <текст>", value: "Установить напоминание (макс 24ч)", inline: false },
              { name: "─── 🛡️ Управление каналом (для админов) ───", value: "\u200b", inline: false },
              { name: "/slowmode <секунды>", value: "Медленный режим (0 — выключить)", inline: false },
              { name: "/lock / /unlock", value: "Закрыть / открыть канал для сообщений", inline: false },
              { name: "/nickname <пользователь> [никнейм]", value: "Сменить никнейм участника", inline: false },
              { name: "/announce <текст> [канал]", value: "Отправить объявление в канал", inline: false },
            )
            .setFooter({ text: "Бот создан с помощью Replit" }),
        ],
      });
    }

    else if (commandName === "info") {
      const guild = interaction.guild!;
      const owner = await guild.fetchOwner();
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xfee75c)
            .setTitle(`🏠 ${guild.name}`)
            .setThumbnail(guild.iconURL())
            .addFields(
              { name: "Владелец", value: `${owner.user.tag}`, inline: true },
              { name: "Участников", value: `${guild.memberCount}`, inline: true },
              { name: "Каналов", value: `${guild.channels.cache.size}`, inline: true },
              { name: "Ролей", value: `${guild.roles.cache.size}`, inline: true },
              { name: "Создан", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
            )
            .setTimestamp(),
        ],
      });
    }

    else if (commandName === "ask") {
      const question = interaction.options.getString("вопрос", true);
      await interaction.deferReply();

      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        max_completion_tokens: 8192,
        messages: [
          {
            role: "system",
            content:
              "Ты полезный ИИ-ассистент в Discord. Отвечай кратко и по делу, используй Discord Markdown для форматирования.",
          },
          { role: "user", content: question },
        ],
      });

      const answer = response.choices[0]?.message?.content ?? "Не удалось получить ответ.";
      const truncated = answer.length > 4000 ? answer.slice(0, 3997) + "..." : answer;

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("🤖 Ответ ИИ")
            .setDescription(truncated)
            .setFooter({ text: `Вопрос: ${question.slice(0, 80)}` }),
        ],
      });
    }

    else if (commandName === "ban") {
      const target = interaction.options.getMember("пользователь") as GuildMember | null;
      const reason = interaction.options.getString("причина") ?? "Причина не указана";

      if (!target) {
        await interaction.reply({ content: "❌ Пользователь не найден.", ephemeral: true });
        return;
      }

      if (!target.bannable) {
        await interaction.reply({ content: "❌ Не могу забанить этого пользователя.", ephemeral: true });
        return;
      }

      await target.ban({ reason });
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle("🔨 Пользователь забанен")
            .addFields(
              { name: "Пользователь", value: `${target.user.tag}`, inline: true },
              { name: "Причина", value: reason, inline: true }
            ),
        ],
      });
    }

    else if (commandName === "kick") {
      const target = interaction.options.getMember("пользователь") as GuildMember | null;
      const reason = interaction.options.getString("причина") ?? "Причина не указана";

      if (!target) {
        await interaction.reply({ content: "❌ Пользователь не найден.", ephemeral: true });
        return;
      }

      if (!target.kickable) {
        await interaction.reply({ content: "❌ Не могу кикнуть этого пользователя.", ephemeral: true });
        return;
      }

      await target.kick(reason);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xffa500)
            .setTitle("👢 Пользователь кикнут")
            .addFields(
              { name: "Пользователь", value: `${target.user.tag}`, inline: true },
              { name: "Причина", value: reason, inline: true }
            ),
        ],
      });
    }

    else if (commandName === "mute") {
      const target = interaction.options.getMember("пользователь") as GuildMember | null;
      const minutes = interaction.options.getInteger("минуты", true);
      const reason = interaction.options.getString("причина") ?? "Причина не указана";

      if (!target) {
        await interaction.reply({ content: "❌ Пользователь не найден.", ephemeral: true });
        return;
      }

      if (!target.moderatable) {
        await interaction.reply({ content: "❌ Не могу замьютить этого пользователя.", ephemeral: true });
        return;
      }

      const durationMs = minutes * 60 * 1000;
      await target.timeout(durationMs, reason);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xfee75c)
            .setTitle("🔇 Пользователь замьючен")
            .addFields(
              { name: "Пользователь", value: `${target.user.tag}`, inline: true },
              { name: "Время", value: `${minutes} мин.`, inline: true },
              { name: "Причина", value: reason, inline: false }
            ),
        ],
      });
    }

    else if (commandName === "unmute") {
      const target = interaction.options.getMember("пользователь") as GuildMember | null;

      if (!target) {
        await interaction.reply({ content: "❌ Пользователь не найден.", ephemeral: true });
        return;
      }

      await target.timeout(null);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle("🔊 Мут снят")
            .setDescription(`${target.user.tag} может снова говорить.`),
        ],
      });
    }

    else if (commandName === "purge") {
      const amount = interaction.options.getInteger("количество", true);
      const channel = interaction.channel;

      if (!channel || !channel.isTextBased() || channel.isDMBased()) {
        await interaction.reply({ content: "❌ Команда доступна только в текстовых каналах.", ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const deleted = await (channel as import("discord.js").TextChannel).bulkDelete(amount, true);
      await interaction.editReply({
        content: `✅ Удалено **${deleted.size}** сообщений.`,
      });
    }

    else if (commandName === "role") {
      const target = interaction.options.getMember("пользователь") as GuildMember | null;
      const role = interaction.options.getRole("роль");

      if (!target || !role) {
        await interaction.reply({ content: "❌ Пользователь или роль не найдены.", ephemeral: true });
        return;
      }

      const hasRole = target.roles.cache.has(role.id);

      if (hasRole) {
        await target.roles.remove(role.id);
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle("🏷️ Роль снята")
              .setDescription(`Роль **${role.name}** снята у ${target.user.tag}.`),
          ],
        });
      } else {
        await target.roles.add(role.id);
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle("🏷️ Роль выдана")
              .setDescription(`Роль **${role.name}** выдана ${target.user.tag}.`),
          ],
        });
      }
    }

    else if (commandName === "chat") {
      const sub = interaction.options.getSubcommand();
      const channelId = interaction.channelId;

      if (sub === "on") {
        chatModeChannels.add(channelId);
        if (!conversationHistory.has(channelId)) {
          conversationHistory.set(channelId, []);
        }
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle("💬 Режим чата включён")
              .setDescription(
                "Теперь я буду отвечать на **каждое сообщение** в этом канале.\nЧтобы выключить — используй `/chat off`."
              ),
          ],
        });
      } else if (sub === "off") {
        chatModeChannels.delete(channelId);
        conversationHistory.delete(channelId);
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle("💬 Режим чата выключен")
              .setDescription("Я больше не буду отвечать на обычные сообщения в этом канале."),
          ],
        });
      }
    }

    else if (commandName === "warn") {
      const target = interaction.options.getMember("пользователь") as GuildMember | null;
      const reason = interaction.options.getString("причина") ?? "Причина не указана";

      if (!target) {
        await interaction.reply({ content: "❌ Пользователь не найден.", ephemeral: true });
        return;
      }

      if (target.user.bot) {
        await interaction.reply({ content: "❌ Нельзя предупреждать ботов.", ephemeral: true });
        return;
      }

      addWarning(interaction.guildId!, target.id, {
        reason,
        moderator: interaction.user.tag,
        timestamp: Date.now(),
      });

      const warnCount = getUserWarnings(interaction.guildId!, target.id).length;

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xffa500)
            .setTitle("⚠️ Предупреждение выдано")
            .addFields(
              { name: "Пользователь", value: `${target.user.tag}`, inline: true },
              { name: "Предупреждений всего", value: `${warnCount}`, inline: true },
              { name: "Причина", value: reason, inline: false },
              { name: "Модератор", value: interaction.user.tag, inline: true },
            )
            .setTimestamp(),
        ],
      });

      try {
        await target.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xffa500)
              .setTitle(`⚠️ Ты получил предупреждение на сервере ${interaction.guild!.name}`)
              .addFields(
                { name: "Причина", value: reason },
                { name: "Предупреждений всего", value: `${warnCount}` },
              )
              .setTimestamp(),
          ],
        });
      } catch {
        // DM отключены — ничего страшного
      }
    }

    else if (commandName === "warnings") {
      const target = interaction.options.getUser("пользователь", true);
      const warnList = getUserWarnings(interaction.guildId!, target.id);

      if (warnList.length === 0) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle("✅ Предупреждений нет")
              .setDescription(`У ${target.tag} нет ни одного предупреждения.`),
          ],
        });
        return;
      }

      const lines = warnList.map((w, i) => {
        const date = new Date(w.timestamp).toLocaleString("ru-RU");
        return `**${i + 1}.** ${w.reason}\n_ Выдал:_ ${w.moderator} • ${date}`;
      });

      const embed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle(`⚠️ Предупреждения: ${target.tag}`)
        .setDescription(lines.join("\n\n").slice(0, 4000))
        .setFooter({ text: `Всего предупреждений: ${warnList.length}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === "clearwarns") {
      const target = interaction.options.getUser("пользователь", true);
      const before = getUserWarnings(interaction.guildId!, target.id).length;
      clearWarnings(interaction.guildId!, target.id);

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle("🗑️ Предупреждения сброшены")
            .setDescription(`Удалено **${before}** предупреждений у ${target.tag}.`),
        ],
      });
    }

    else if (commandName === "play") {
      const query = interaction.options.getString("запрос", true);
      const member = interaction.member as GuildMember | null;
      const voiceChannel = member?.voice?.channel;

      if (!voiceChannel) {
        await interaction.reply({ content: "❌ Ты должен быть в голосовом канале!", ephemeral: true });
        return;
      }

      await interaction.deferReply();
      const result = await addToQueue(voiceChannel, interaction.channelId, query, interaction.user.tag);

      if ("error" in result) {
        await interaction.editReply({ content: `❌ ${result.error}` });
        return;
      }

      const { track, position } = result;
      if (position === 1) {
        await interaction.editReply({ content: "⏳ Загружаю трек..." });
        await interaction.deleteReply().catch(() => {});
      } else {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle("➕ Добавлено в очередь")
              .setDescription(`**[${track.title}](${track.url})**`)
              .addFields(
                { name: "⏱ Длительность", value: track.duration || "?", inline: true },
                { name: "📋 Позиция", value: `#${position}`, inline: true }
              )
              .setThumbnail(track.thumbnail || null),
          ],
        });
      }
    }

    else if (commandName === "stop") {
      const stopped = stopMusic(interaction.guildId!);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(stopped ? 0xed4245 : 0xfee75c)
            .setTitle(stopped ? "⏹️ Музыка остановлена" : "❌ Музыка не играет")
            .setDescription(stopped ? "Бот покинул голосовой канал." : "Нечего останавливать."),
        ],
      });
    }

    else if (commandName === "skip") {
      const skipped = skipTrack(interaction.guildId!);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(skipped ? 0xffa500 : 0xfee75c)
            .setTitle(skipped ? "⏭️ Трек пропущен" : "❌ Нечего пропускать")
            .setDescription(skipped ? `Пропущен: **${skipped.title}**` : "Очередь пуста."),
        ],
      });
    }

    else if (commandName === "queue") {
      const tracks = getQueueList(interaction.guildId!);
      if (tracks.length === 0) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xfee75c)
              .setTitle("📋 Очередь пуста")
              .setDescription("Добавь треки через `/play`!"),
          ],
        });
        return;
      }

      const loopStatus = isLooping(interaction.guildId!) ? " 🔁" : "";
      const lines = tracks.map((t, i) =>
        i === 0
          ? `▶️ **${t.title}** — ${t.duration}`
          : `\`${i + 1}.\` ${t.title} — ${t.duration}`
      );

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`📋 Очередь${loopStatus}`)
        .setDescription(lines.slice(0, 15).join("\n").slice(0, 4000))
        .setFooter({ text: `Треков в очереди: ${tracks.length}` });

      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === "pause") {
      const paused = pauseMusic(interaction.guildId!);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(paused ? 0xfee75c : 0xed4245)
            .setTitle(paused ? "⏸️ Пауза" : "❌ Не удалось поставить на паузу")
            .setDescription(paused ? "Воспроизведение приостановлено. Продолжи с `/resume`." : "Музыка не играет."),
        ],
      });
    }

    else if (commandName === "resume") {
      const resumed = resumeMusic(interaction.guildId!);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(resumed ? 0x57f287 : 0xed4245)
            .setTitle(resumed ? "▶️ Продолжаю" : "❌ Не на паузе")
            .setDescription(resumed ? "Воспроизведение продолжено!" : "Музыка не на паузе."),
        ],
      });
    }

    else if (commandName === "nowplaying") {
      const track = getNowPlaying(interaction.guildId!);
      if (!track) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xfee75c)
              .setTitle("❌ Сейчас ничего не играет")
              .setDescription("Добавь трек через `/play`!"),
          ],
        });
        return;
      }

      const loop = isLooping(interaction.guildId!) ? " 🔁" : "";
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle(`▶️ Сейчас играет${loop}`)
            .setDescription(`**[${track.title}](${track.url})**`)
            .addFields(
              { name: "⏱ Длительность", value: track.duration || "?", inline: true },
              { name: "👤 Запросил", value: track.requestedBy, inline: true }
            )
            .setThumbnail(track.thumbnail || null)
            .setTimestamp(),
        ],
      });
    }

    else if (commandName === "loop") {
      const loopState = toggleLoop(interaction.guildId!);
      if (loopState === null) {
        await interaction.reply({ content: "❌ Музыка не играет.", ephemeral: true });
        return;
      }
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(loopState ? 0x57f287 : 0xffa500)
            .setTitle(loopState ? "🔁 Повтор включён" : "➡️ Повтор выключен")
            .setDescription(loopState ? "Текущий трек будет повторяться." : "Треки играют по очереди."),
        ],
      });
    }

    else if (commandName === "remove") {
      const pos = interaction.options.getInteger("номер", true);
      const tracks = getQueueList(interaction.guildId!);

      if (pos > tracks.length) {
        await interaction.reply({ content: `❌ В очереди только ${tracks.length} трек(ов).`, ephemeral: true });
        return;
      }

      const removed = removeFromQueue(interaction.guildId!, pos - 1);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(removed ? 0xed4245 : 0xfee75c)
            .setTitle(removed ? "🗑️ Трек удалён" : "❌ Не удалось удалить")
            .setDescription(removed ? `Удалён: **${removed.title}**` : "Трек не найден."),
        ],
      });
    }

    else if (commandName === "say") {
      const member = interaction.member as GuildMember | null;
      if (!member || !isAdminOrOwner(member, interaction.guild!)) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle("🚫 Нет доступа")
              .setDescription("Команда `/say` доступна только **овнеру** и **администраторам** сервера."),
          ],
          ephemeral: true,
        });
        return;
      }

      const text = interaction.options.getString("текст", true);
      const channelOption = interaction.options.getChannel("канал");

      let targetChannel: import("discord.js").TextChannel;

      if (channelOption) {
        const fetched = await interaction.guild!.channels.fetch(channelOption.id);
        if (!fetched || !fetched.isTextBased() || fetched.isDMBased()) {
          await interaction.reply({ content: "❌ Указанный канал недоступен.", ephemeral: true });
          return;
        }
        targetChannel = fetched as import("discord.js").TextChannel;
      } else {
        if (!interaction.channel || !interaction.channel.isTextBased() || interaction.channel.isDMBased()) {
          await interaction.reply({ content: "❌ Текущий канал недоступен.", ephemeral: true });
          return;
        }
        targetChannel = interaction.channel as import("discord.js").TextChannel;
      }

      const sent = await targetChannel.send(text);

      sayLog.set(sent.id, {
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        content: text,
        channelId: targetChannel.id,
        timestamp: Date.now(),
      });

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle("✅ Сообщение отправлено")
            .setDescription(`Отправлено в <#${targetChannel.id}>`)
            .setFooter({ text: `ID сообщения: ${sent.id}` }),
        ],
        ephemeral: true,
      });
    }

    else if (commandName === "whosaid") {
      const member = interaction.member as GuildMember | null;
      if (!member || !isAdminOrOwner(member, interaction.guild!)) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle("🚫 Нет доступа")
              .setDescription("Команда `/whosaid` доступна только **овнеру** и **администраторам** сервера."),
          ],
          ephemeral: true,
        });
        return;
      }

      const messageId = interaction.options.getString("id", true).trim();
      const log = sayLog.get(messageId);

      if (!log) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xfee75c)
              .setTitle("❓ Не найдено")
              .setDescription("Это сообщение не было отправлено через `/say`, или запись не сохранилась (бот перезапускался)."),
          ],
          ephemeral: true,
        });
        return;
      }

      const date = new Date(log.timestamp).toLocaleString("ru-RU");
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("🔍 Автор сообщения")
            .addFields(
              { name: "Написал", value: `<@${log.userId}> (${log.userTag})`, inline: false },
              { name: "Канал", value: `<#${log.channelId}>`, inline: true },
              { name: "Дата", value: date, inline: true },
              { name: "Текст", value: log.content.slice(0, 1024), inline: false },
            ),
        ],
        ephemeral: true,
      });
    }

    else if (commandName === "8ball") {
      const question = interaction.options.getString("вопрос", true);
      const answers = [
        "✅ Бесспорно!", "✅ Предрешено!", "✅ Без сомнений!", "✅ Определённо да!",
        "✅ Можешь быть уверен в этом.", "🟡 Скорее всего.", "🟡 Хорошие перспективы.",
        "🟡 Знаки говорят — да.", "🟡 Да.", "🟡 Пока не ясно, попробуй снова.",
        "🟡 Спроси позже.", "🟡 Лучше не рассказывать.", "🟡 Сейчас нельзя предсказать.",
        "❌ Не рассчитывай на это.", "❌ Мой ответ — нет.", "❌ По моим данным — нет.",
        "❌ Перспективы не очень.", "❌ Весьма сомнительно.",
      ];
      const answer = answers[Math.floor(Math.random() * answers.length)];
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("🎱 Магический шар")
            .addFields(
              { name: "Вопрос", value: question },
              { name: "Ответ", value: answer },
            ),
        ],
      });
    }

    else if (commandName === "coinflip") {
      const result = Math.random() < 0.5 ? "🦅 Орёл" : "🪙 Решка";
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xfee75c)
            .setTitle("🪙 Монетка")
            .setDescription(`Выпало: **${result}**`),
        ],
      });
    }

    else if (commandName === "dice") {
      const sides = interaction.options.getInteger("стороны") ?? 6;
      const roll = Math.floor(Math.random() * sides) + 1;
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle(`🎲 Кубик d${sides}`)
            .setDescription(`Выпало: **${roll}**`),
        ],
      });
    }

    else if (commandName === "joke") {
      const jokes = [
        "Почему программисты путают Хэллоуин и Рождество? Потому что Oct 31 == Dec 25!",
        "Я думал, что буду лучше спать после того, как установил новое приложение для сна. Но потом оно попросило обновление.",
        "Муж спрашивает жену: — Ты где?\n— Дома.\n— Странно, я тоже дома, но тебя не вижу...\n— Я имею в виду приложение Home.",
        "Сказал другу, что изучаю Python. Он спросил: — А не опасно? Они же ядовитые.",
        "Почему скелет не пошёл на вечеринку? Потому что ему было не с кем пойти — у него не было тела.",
        "Почему Wi-Fi и жена похожи? Потому что если пропадают — сразу замечаешь.",
        "— Кто сильнее: слон или муравей?\n— Муравей. Он может нести 50 своих масс.\n— А слон?\n— Слон может нести 50 муравьёв.",
        "Пошёл к врачу. Говорю: — Доктор, я сломал руку в трёх местах. Он: — Не ходите в эти места.",
      ];
      const joke = jokes[Math.floor(Math.random() * jokes.length)];
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xffa500)
            .setTitle("😂 Шутка дня")
            .setDescription(joke),
        ],
      });
    }

    else if (commandName === "poll") {
      const question = interaction.options.getString("вопрос", true);
      const rawOptions = interaction.options.getString("варианты", true);
      const options = rawOptions.split(",").map((o) => o.trim()).filter(Boolean).slice(0, 9);

      if (options.length < 2) {
        await interaction.reply({ content: "❌ Нужно минимум 2 варианта, разделённых запятой.", ephemeral: true });
        return;
      }

      const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
      const description = options.map((o, i) => `${emojis[i]} ${o}`).join("\n");

      const pollMsg = await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`📊 ${question}`)
            .setDescription(description)
            .setFooter({ text: `Голосование создал ${interaction.user.tag}` })
            .setTimestamp(),
        ],
        fetchReply: true,
      });

      for (let i = 0; i < options.length; i++) {
        await pollMsg.react(emojis[i]!).catch(() => {});
      }
    }

    else if (commandName === "avatar") {
      const target = interaction.options.getUser("пользователь") ?? interaction.user;
      const avatarUrl = target.displayAvatarURL({ size: 512 });
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`🖼️ Аватар — ${target.tag}`)
            .setImage(avatarUrl)
            .setURL(avatarUrl),
        ],
      });
    }

    else if (commandName === "remind") {
      const minutes = interaction.options.getInteger("минуты", true);
      const text = interaction.options.getString("текст", true);
      const userId = interaction.user.id;
      const channelId = interaction.channelId;

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle("⏰ Напоминание установлено")
            .setDescription(`Напомню тебе через **${minutes} мин.**: ${text}`),
        ],
      });

      setTimeout(async () => {
        try {
          const channel = await client.channels.fetch(channelId);
          if (channel?.isTextBased() && !channel.isDMBased()) {
            await (channel as import("discord.js").TextChannel).send({
              content: `<@${userId}>`,
              embeds: [
                new EmbedBuilder()
                  .setColor(0xfee75c)
                  .setTitle("⏰ Напоминание!")
                  .setDescription(text)
                  .setTimestamp(),
              ],
            });
          }
        } catch (err) {
          logger.error({ err }, "Failed to send reminder");
        }
      }, minutes * 60 * 1000);
    }
    else if (commandName === "serverinfo") {
      const guild = interaction.guild!;
      await guild.members.fetch().catch(() => {});
      const online = guild.members.cache.filter((m) => m.presence?.status !== "offline" && m.presence?.status !== undefined).size;
      const bots = guild.members.cache.filter((m) => m.user.bot).size;
      const humans = guild.memberCount - bots;
      const roles = guild.roles.cache.size - 1;
      const channels = guild.channels.cache.size;
      const created = `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`;

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`📊 ${guild.name}`)
            .setThumbnail(guild.iconURL() ?? null)
            .addFields(
              { name: "👑 Владелец", value: `<@${guild.ownerId}>`, inline: true },
              { name: "📅 Создан", value: created, inline: true },
              { name: "🌍 Регион", value: guild.preferredLocale || "Глобальный", inline: true },
              { name: "👥 Участники", value: `${guild.memberCount} (людей: ${humans}, ботов: ${bots})`, inline: false },
              { name: "💬 Каналы", value: `${channels}`, inline: true },
              { name: "🎭 Ролей", value: `${roles}`, inline: true },
              { name: "😀 Эмодзи", value: `${guild.emojis.cache.size}`, inline: true },
              { name: "🔒 Верификация", value: String(guild.verificationLevel), inline: true },
              { name: "🆔 ID сервера", value: guild.id, inline: false }
            )
            .setFooter({ text: `Запросил ${interaction.user.tag}` })
            .setTimestamp(),
        ],
      });
    }

    else if (commandName === "userinfo") {
      const target = interaction.options.getUser("пользователь") ?? interaction.user;
      const member = await interaction.guild!.members.fetch(target.id).catch(() => null);
      const roles = member?.roles.cache
        .filter((r) => r.id !== interaction.guild!.id)
        .sort((a, b) => b.position - a.position)
        .map((r) => `${r}`)
        .slice(0, 10)
        .join(" ") || "Нет ролей";

      const joined = member?.joinedTimestamp
        ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`
        : "Неизвестно";
      const created = `<t:${Math.floor(target.createdTimestamp / 1000)}:D>`;
      const badges = target.flags?.toArray().map((f) => f.toString()).join(", ") || "Нет";

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(member?.displayHexColor ?? 0x5865f2)
            .setTitle(`👤 ${target.tag}`)
            .setThumbnail(target.displayAvatarURL({ size: 256 }))
            .addFields(
              { name: "🆔 ID", value: target.id, inline: true },
              { name: "🤖 Бот", value: target.bot ? "Да" : "Нет", inline: true },
              { name: "📅 Зарегистрирован", value: created, inline: true },
              { name: "📥 Вступил на сервер", value: joined, inline: true },
              { name: "🏷️ Псевдоним", value: member?.nickname || "Нет", inline: true },
              { name: "🎖️ Высшая роль", value: member?.roles.highest.toString() || "Нет", inline: true },
              { name: `🎭 Роли (${member?.roles.cache.size ? member.roles.cache.size - 1 : 0})`, value: roles, inline: false },
              { name: "🏅 Значки", value: badges, inline: false }
            )
            .setTimestamp(),
        ],
      });
    }

    else if (commandName === "roll") {
      const min = interaction.options.getInteger("мин") ?? 1;
      const max = interaction.options.getInteger("макс") ?? 100;
      if (min >= max) {
        await interaction.reply({ content: "❌ Минимум должен быть меньше максимума!", ephemeral: true });
        return;
      }
      const result = Math.floor(Math.random() * (max - min + 1)) + min;
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("🎲 Результат броска")
            .setDescription(`**${result}**`)
            .setFooter({ text: `Диапазон: ${min} – ${max} • ${interaction.user.tag}` }),
        ],
      });
    }

    else if (commandName === "hug") {
      const target = interaction.options.getUser("пользователь", true);
      const gifs = [
        "https://media.tenor.com/qkFmWHqgEIoAAAAC/hug.gif",
        "https://media.tenor.com/mOGWZFJuJnIAAAAC/hug-cute.gif",
        "https://media.tenor.com/aKQ_x1vDJPoAAAAC/anime-hug.gif",
        "https://media.tenor.com/tNrKq9-5s4kAAAAC/naruto-itachi.gif",
        "https://media.tenor.com/ESLD6Mb_P7oAAAAC/hug-anime.gif",
      ];
      const gif = gifs[Math.floor(Math.random() * gifs.length)]!;
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff69b4)
            .setDescription(`💗 **${interaction.user.displayName}** обнимает **${target.displayName}**! 🤗`)
            .setImage(gif),
        ],
      });
    }

    else if (commandName === "ship") {
      const user1 = interaction.options.getUser("пользователь1", true);
      const user2 = interaction.options.getUser("пользователь2") ?? interaction.user;
      const combined = user1.id + user2.id;
      let hash = 0;
      for (const c of combined) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
      const percent = Math.abs(hash) % 101;
      const bar = "█".repeat(Math.floor(percent / 10)) + "░".repeat(10 - Math.floor(percent / 10));
      const label = percent < 20 ? "💀 Нет шансов" : percent < 40 ? "😬 Слабо" : percent < 60 ? "🙂 Возможно" : percent < 80 ? "💖 Хорошие шансы" : "❤️‍🔥 Идеальная пара!";
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff69b4)
            .setTitle("💘 Ship-тест")
            .setDescription(`**${user1.displayName}** ❤️ **${user2.displayName}**\n\n\`[${bar}]\` **${percent}%**\n\n${label}`),
        ],
      });
    }

    else if (commandName === "slowmode") {
      if (!isAdminOrOwner(interaction.member as GuildMember)) {
        await interaction.reply({ content: "❌ Только администраторы могут менять медленный режим.", ephemeral: true });
        return;
      }
      const seconds = interaction.options.getInteger("секунды", true);
      const channel = interaction.channel;
      if (!channel || !channel.isTextBased() || channel.isDMBased() || !("setRateLimitPerUser" in channel)) {
        await interaction.reply({ content: "❌ Эту команду можно использовать только в текстовых каналах.", ephemeral: true });
        return;
      }
      await (channel as import("discord.js").TextChannel).setRateLimitPerUser(seconds, `Slowmode set by ${interaction.user.tag}`);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xffa500)
            .setTitle(seconds === 0 ? "✅ Медленный режим выключен" : `⏱️ Медленный режим: ${seconds}с`)
            .setDescription(seconds === 0 ? "Ограничения сняты." : `Участники могут писать раз в **${seconds} секунд**.`),
        ],
      });
    }

    else if (commandName === "lock") {
      if (!isAdminOrOwner(interaction.member as GuildMember)) {
        await interaction.reply({ content: "❌ Только администраторы могут закрывать каналы.", ephemeral: true });
        return;
      }
      const channel = interaction.channel;
      if (!channel || !channel.isTextBased() || channel.isDMBased() || !("permissionOverwrites" in channel)) {
        await interaction.reply({ content: "❌ Эту команду можно использовать только в текстовых каналах.", ephemeral: true });
        return;
      }
      const everyoneRole = interaction.guild!.roles.everyone;
      await (channel as import("discord.js").TextChannel).permissionOverwrites.edit(everyoneRole, {
        SendMessages: false,
      });
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle("🔒 Канал заблокирован")
            .setDescription("Участники больше не могут отправлять сообщения в этот канал."),
        ],
      });
    }

    else if (commandName === "unlock") {
      if (!isAdminOrOwner(interaction.member as GuildMember)) {
        await interaction.reply({ content: "❌ Только администраторы могут открывать каналы.", ephemeral: true });
        return;
      }
      const channel = interaction.channel;
      if (!channel || !channel.isTextBased() || channel.isDMBased() || !("permissionOverwrites" in channel)) {
        await interaction.reply({ content: "❌ Эту команду можно использовать только в текстовых каналах.", ephemeral: true });
        return;
      }
      const everyoneRole = interaction.guild!.roles.everyone;
      await (channel as import("discord.js").TextChannel).permissionOverwrites.edit(everyoneRole, {
        SendMessages: null,
      });
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle("🔓 Канал разблокирован")
            .setDescription("Участники снова могут отправлять сообщения."),
        ],
      });
    }

    else if (commandName === "nickname") {
      if (!isAdminOrOwner(interaction.member as GuildMember)) {
        await interaction.reply({ content: "❌ Только администраторы могут менять никнеймы.", ephemeral: true });
        return;
      }
      const target = interaction.options.getUser("пользователь", true);
      const nick = interaction.options.getString("никнейм") ?? null;
      const member = await interaction.guild!.members.fetch(target.id).catch(() => null);
      if (!member) {
        await interaction.reply({ content: "❌ Пользователь не найден на сервере.", ephemeral: true });
        return;
      }
      try {
        await member.setNickname(nick, `Changed by ${interaction.user.tag}`);
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle(nick ? "✏️ Никнейм изменён" : "✏️ Никнейм сброшен")
              .addFields(
                { name: "👤 Пользователь", value: `${target}`, inline: true },
                { name: "🏷️ Новый никнейм", value: nick ?? target.username, inline: true }
              ),
          ],
        });
      } catch {
        await interaction.reply({ content: "❌ Не удалось изменить никнейм. Возможно, у бота нет прав.", ephemeral: true });
      }
    }

    else if (commandName === "announce") {
      if (!isAdminOrOwner(interaction.member as GuildMember)) {
        await interaction.reply({ content: "❌ Только администраторы могут делать объявления.", ephemeral: true });
        return;
      }
      const text = interaction.options.getString("текст", true);
      const targetChannel = interaction.options.getChannel("канал") ?? interaction.channel;
      if (!targetChannel || !("send" in targetChannel)) {
        await interaction.reply({ content: "❌ Не удалось получить канал.", ephemeral: true });
        return;
      }
      await (targetChannel as import("discord.js").TextChannel).send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xfee75c)
            .setTitle("📢 Объявление")
            .setDescription(text)
            .setFooter({ text: `От ${interaction.user.tag}` })
            .setTimestamp(),
        ],
      });
      await interaction.reply({ content: `✅ Объявление отправлено в ${targetChannel}.`, ephemeral: true });
    }

  } catch (err) {
    logger.error({ err, commandName }, "Error handling slash command");
    const errMsg = "❌ Произошла ошибка при выполнении команды.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: errMsg }).catch(() => {});
    } else {
      await interaction.reply({ content: errMsg, ephemeral: true }).catch(() => {});
    }
  }
});

client.on("messageCreate", async (message: Message) => {
  if (message.author.bot) return;
  if (!chatModeChannels.has(message.channelId)) return;
  if (!message.content.trim()) return;

  try {
    await message.channel.sendTyping();

    const history = conversationHistory.get(message.channelId) ?? [];

    history.push({ role: "user", content: `${message.author.displayName}: ${message.content}` });

    if (history.length > 40) {
      history.splice(0, history.length - 40);
    }

    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 8192,
      messages: [
        {
          role: "system",
          content:
            "Ты дружелюбный и остроумный ИИ-ассистент в Discord. Общаешься непринуждённо и весело, как хороший друг. Используй Discord Markdown. Отвечай кратко — не более 3-4 предложений, если не просят подробнее. Не повторяй имя пользователя в каждом ответе.",
        },
        ...history,
      ],
    });

    const reply = response.choices[0]?.message?.content ?? "Не могу ответить прямо сейчас.";

    history.push({ role: "assistant", content: reply });
    conversationHistory.set(message.channelId, history);

    const truncated = reply.length > 2000 ? reply.slice(0, 1997) + "..." : reply;
    await message.reply(truncated);
  } catch (err) {
    logger.error({ err }, "Error in chat mode response");
  }
});

export async function startBot() {
  await client.login(token);
}
