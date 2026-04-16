import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  getVoiceConnection,
  joinVoiceChannel,
  NoSubscriberBehavior,
  VoiceConnection,
} from "@discordjs/voice";
import play from "play-dl";
import { Client, EmbedBuilder, TextChannel, VoiceBasedChannel } from "discord.js";
import { logger } from "../lib/logger";

export interface Track {
  title: string;
  url: string;
  duration: string;
  thumbnail: string;
  requestedBy: string;
}

interface GuildQueue {
  tracks: Track[];
  player: AudioPlayer;
  connection: VoiceConnection;
  textChannelId: string;
  looping: boolean;
}

const queues = new Map<string, GuildQueue>();
let discordClient: Client;

export function initMusic(client: Client) {
  discordClient = client;
}

async function sendToChannel(textChannelId: string, embed: EmbedBuilder) {
  try {
    const ch = await discordClient.channels.fetch(textChannelId);
    if (ch?.isTextBased() && !ch.isDMBased()) {
      await (ch as TextChannel).send({ embeds: [embed] });
    }
  } catch (err) {
    logger.error({ err }, "Failed to send music embed");
  }
}

async function playNext(guildId: string) {
  const queue = queues.get(guildId);
  if (!queue) return;

  if (queue.tracks.length === 0) {
    await sendToChannel(
      queue.textChannelId,
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("🎵 Очередь закончилась")
        .setDescription("Все треки воспроизведены. Добавь ещё через `/play`!")
    );
    queue.connection.destroy();
    queues.delete(guildId);
    return;
  }

  const track = queue.tracks[0]!;
  try {
    const stream = await play.stream(track.url);
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
    });
    queue.player.play(resource);

    await sendToChannel(
      queue.textChannelId,
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("▶️ Сейчас играет")
        .setDescription(`**[${track.title}](${track.url})**`)
        .addFields(
          { name: "⏱ Длительность", value: track.duration || "?", inline: true },
          { name: "👤 Запросил", value: track.requestedBy, inline: true }
        )
        .setThumbnail(track.thumbnail || null)
        .setTimestamp()
    );
  } catch (err) {
    logger.error({ err, title: track.title }, "Failed to stream track");
    queue.tracks.shift();
    await playNext(guildId);
  }
}

export async function addToQueue(
  voiceChannel: VoiceBasedChannel,
  textChannelId: string,
  query: string,
  requestedBy: string
): Promise<{ track: Track; position: number } | { error: string }> {
  const guildId = voiceChannel.guild.id;

  let videoInfo: Awaited<ReturnType<typeof play.video_info>> | undefined;
  let videoDetails: typeof videoInfo extends undefined ? never : NonNullable<typeof videoInfo>["video_details"] | undefined;

  try {
    const validated = play.yt_validate(query);
    if (validated === "video") {
      const info = await play.video_info(query);
      videoDetails = info.video_details;
    } else if (validated === "playlist") {
      return { error: "Плейлисты пока не поддерживаются. Укажи ссылку на видео или название трека." };
    } else {
      const results = await play.search(query, { limit: 1, source: { youtube: "video" } });
      if (!results.length || !results[0]?.id) return { error: "Ничего не найдено по запросу." };
      const info = await play.video_info(`https://www.youtube.com/watch?v=${results[0].id}`);
      videoDetails = info.video_details;
    }
  } catch (err) {
    logger.error({ err }, "Failed to search YouTube");
    return { error: "Не удалось найти трек. Попробуй другой запрос." };
  }

  if (!videoDetails) return { error: "Трек не найден." };

  const track: Track = {
    title: videoDetails.title ?? "Неизвестный трек",
    url: videoDetails.url,
    duration: videoDetails.durationRaw ?? "?",
    thumbnail: videoDetails.thumbnails?.[0]?.url ?? "",
    requestedBy,
  };

  let queue = queues.get(guildId);

  if (!queue) {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });

    connection.subscribe(player);

    player.on(AudioPlayerStatus.Idle, () => {
      const q = queues.get(guildId);
      if (!q) return;
      if (!q.looping) {
        q.tracks.shift();
      }
      playNext(guildId).catch((err) => logger.error({ err }, "playNext error"));
    });

    player.on("error", (err) => {
      logger.error({ err }, "Audio player error");
      const q = queues.get(guildId);
      if (!q) return;
      q.tracks.shift();
      playNext(guildId).catch(() => {});
    });

    queue = {
      tracks: [],
      player,
      connection,
      textChannelId,
      looping: false,
    };

    queues.set(guildId, queue);
  }

  queue.tracks.push(track);
  const position = queue.tracks.length;

  if (queue.tracks.length === 1) {
    await playNext(guildId);
  }

  return { track, position };
}

export function stopMusic(guildId: string): boolean {
  const queue = queues.get(guildId);
  if (!queue) return false;
  queue.tracks = [];
  queue.player.stop(true);
  queue.connection.destroy();
  queues.delete(guildId);
  return true;
}

export function skipTrack(guildId: string): Track | null {
  const queue = queues.get(guildId);
  if (!queue || queue.tracks.length === 0) return null;
  const skipped = queue.tracks[0]!;
  queue.player.stop();
  return skipped;
}

export function pauseMusic(guildId: string): boolean {
  const queue = queues.get(guildId);
  if (!queue) return false;
  return queue.player.pause();
}

export function resumeMusic(guildId: string): boolean {
  const queue = queues.get(guildId);
  if (!queue) return false;
  return queue.player.unpause();
}

export function toggleLoop(guildId: string): boolean | null {
  const queue = queues.get(guildId);
  if (!queue) return null;
  queue.looping = !queue.looping;
  return queue.looping;
}

export function getNowPlaying(guildId: string): Track | null {
  return queues.get(guildId)?.tracks[0] ?? null;
}

export function getQueueList(guildId: string): Track[] {
  return queues.get(guildId)?.tracks ?? [];
}

export function isLooping(guildId: string): boolean {
  return queues.get(guildId)?.looping ?? false;
}

export function removeFromQueue(guildId: string, index: number): Track | null {
  const queue = queues.get(guildId);
  if (!queue || index < 1 || index >= queue.tracks.length) return null;
  const [removed] = queue.tracks.splice(index, 1);
  return removed ?? null;
}
