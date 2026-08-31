"use client";

import { useEffect, useState } from "react";

import { dateKeyInTimeZone, findAnniversarySpotlight } from "./anniversary.mjs";

export type AnniversarySong = {
  bilibiliUrl: string;
  catalogLabel: "标准题库" | "扩展收录";
  name: string;
  publicationDate: string;
  vocalists: string;
};

type HomeAnniversaryProps = {
  idPrefix: string;
  initialDateKey: string;
  songs: AnniversarySong[];
};

function relativeDayLabel(daysUntil: number) {
  if (daysUntil === 1) return "明天";
  if (daysUntil === 2) return "后天";
  return `${daysUntil} 天后`;
}

function anniversaryLabel(years: number) {
  return years === 0 ? "今天发布" : `${years} 周年`;
}

export default function HomeAnniversary({ idPrefix, initialDateKey, songs }: HomeAnniversaryProps) {
  const [todayKey, setTodayKey] = useState(initialDateKey);

  useEffect(() => {
    const refreshDate = () => setTodayKey(dateKeyInTimeZone(new Date()));
    refreshDate();
    const timer = window.setInterval(refreshDate, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const spotlight = findAnniversarySpotlight(songs, todayKey);
  if (!spotlight) return null;

  const [, month, day] = spotlight.occurrenceDate.split("-");
  const isToday = spotlight.kind === "today";
  const headline = isToday
    ? spotlight.songs.length === 1
      ? spotlight.songs[0].anniversaryYears === 0
        ? "你知道吗？这首歌今天刚刚投稿"
        : `你知道吗？这首歌今天投稿满 ${spotlight.songs[0].anniversaryYears} 周年`
      : `你知道吗？今天有 ${spotlight.songs.length} 首作品迎来投稿纪念日`
    : spotlight.songs.length === 1
      ? `${relativeDayLabel(spotlight.daysUntil)}有一首作品迎来投稿 ${spotlight.songs[0].anniversaryYears} 周年`
      : `${relativeDayLabel(spotlight.daysUntil)}有 ${spotlight.songs.length} 首作品迎来投稿纪念日`;

  return (
    <section className={`home-anniversary ${isToday ? "is-today" : "is-upcoming"}`} aria-labelledby={`${idPrefix}-anniversary-title`}>
      <div className="anniversary-date" aria-hidden="true">
        <small>{isToday ? "TODAY" : "NEXT"}</small>
        <strong>{month}.{day}</strong>
        {!isToday && <span>{spotlight.daysUntil} {spotlight.daysUntil === 1 ? "DAY" : "DAYS"}</span>}
      </div>
      <div className="anniversary-content">
        <span className="anniversary-kicker">{isToday ? "TODAY IN ILEM / 历史上的今天" : "NEXT ANNIVERSARY / 下一次投稿纪念日"}</span>
        <h2 id={`${idPrefix}-anniversary-title`}>{headline}</h2>
        <div className="anniversary-song-list">
          {spotlight.songs.map((song: AnniversarySong & { anniversaryYears: number }) => (
            <article key={`${song.publicationDate}-${song.name}`}>
              <div>
                <h3>《{song.name}》</h3>
                <p>{song.publicationDate.replaceAll("-", ".")} · {song.vocalists} · <b>{song.catalogLabel}</b></p>
              </div>
              <strong>{anniversaryLabel(song.anniversaryYears)}</strong>
              <a href={song.bilibiliUrl} target="_blank" rel="noreferrer">去 B 站重听 <span aria-hidden="true">→</span></a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
