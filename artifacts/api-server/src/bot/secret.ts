import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
} from "@discordjs/voice";
import play from "play-dl";
import { VoiceBasedChannel } from "discord.js";
import { logger } from "../lib/logger";

const FUN_SONGS = [
  { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", label: "🎵 Never Gonna Give You Up" },
  { url: "https://www.youtube.com/watch?v=QH2-TGUlwu4", label: "🐱 Nyan Cat" },
  { url: "https://www.youtube.com/watch?v=j9V78UbdzWI", label: "⚰️ Astronomia (Coffin Dance)" },
  { url: "https://www.youtube.com/watch?v=y6120QOlsfU", label: "🎹 Darude — Sandstorm" },
  { url: "https://www.youtube.com/watch?v=U06jlgpMtQs", label: "🇷🇺 Soviet Anthem" },
  { url: "https://www.youtube.com/watch?v=T3FSj8emlOQ", label: "🐟 Salmon Dance" },
];

const activeSessions = new Map<string, boolean>();

export async function playSecretSong(
  voiceChannel: VoiceBasedChannel
): Promise<{ label: string } | { error: string }> {
  const guildId = voiceChannel.guild.id;

  if (activeSessions.get(guildId)) {
    return { error: "Секрет уже воспроизводится! Подождите." };
  }

  const song = FUN_SONGS[Math.floor(Math.random() * FUN_SONGS.length)]!;

  try {
    const info = await play.video_info(song.url);
    const videoUrl = info.video_details.url;

    if (!videoUrl) return { error: "Не удалось получить URL трека." };

    const stream = await play.stream(videoUrl);
    const resource = createAudioResource(stream.stream, { inputType: stream.type });

    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    connection.subscribe(player);
    player.play(resource);
    activeSessions.set(guildId, true);

    const cleanup = () => {
      activeSessions.delete(guildId);
      try { connection.destroy(); } catch { /* ignore */ }
    };

    player.on(AudioPlayerStatus.Idle, cleanup);
    player.on("error", (err) => {
      logger.error({ err }, "Secret song player error");
      cleanup();
    });

    return { label: song.label };
  } catch (err) {
    activeSessions.delete(guildId);
    logger.error({ err }, "Failed to play secret song");
    return { error: "Не удалось запустить секретную музыку. Попробуй ещё раз!" };
  }
}
