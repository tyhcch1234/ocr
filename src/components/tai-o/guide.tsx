"use client";

import { publicPath } from "@/lib/public-path";
import { useEffect, useState } from "react";

const NAV = [
  { id: "history", label: "歷史" },
  { id: "spots", label: "景點" },
  { id: "food", label: "食物" },
  { id: "itinerary", label: "行程" },
] as const;

const photos = {
  stilts: {
    src: publicPath("/tai-o/stilts.jpg"),
    alt: "大澳涌邊嘅棚屋，前面停住藍色小艇",
    width: 1600,
    height: 1067,
  },
  creek: {
    src: publicPath("/tai-o/creek.jpg"),
    alt: "大澳棚屋排喺木樁上面，屋下係水",
    width: 1600,
    height: 1183,
  },
  temple: {
    src: publicPath("/tai-o/temple.jpg"),
    alt: "大澳楊侯古廟面向水面，門前掛住旗",
    width: 1600,
    height: 1066,
  },
  market: {
    src: publicPath("/tai-o/market.jpg"),
    alt: "大澳街市同路邊行人，後面係老榕",
    width: 1600,
    height: 1200,
  },
} as const;

const spots = [
  {
    title: "棚屋水鄉",
    photo: photos.creek,
    text: "由巴士總站沿住涌行，兩岸都係棚屋。窄巷、木橋、晾住嘅衫同魚乾，先係呢度嘅日常。漲潮屋貼住水面，退潮就見到成排木樁。想由水面睇，涌口有小艇行一圈，收費同班次當日先問。唔坐船，行到行人橋一樣望到成條涌。",
  },
  {
    title: "楊侯古廟",
    photo: photos.temple,
    text: "古廟喺吉慶後街寶珠潭，供奉楊侯，漁民出海之前會嚟祈福。廟內有康熙年間鑄嘅鐘，二零一七年列為法定古蹟。廟向住水，門前旗色好搶眼，屋脊有陶塑。入去靜啲，唔好用閃光燈，亦唔好摸神台。",
  },
  {
    title: "漁村市集同手信街",
    photo: photos.market,
    text: "街市賣菜同海鮮，出面一排舖頭就係手信：蝦醬、鹹魚、魚乾、蛋散、龍鬚糖。氣味重，係大澳本身嘅味道。買之前睇清楚包裝日期，問清楚係咪本地製。蝦醬同鹹魚要密封，先至唔會整臭成袋嘢。",
  },
] as const;

const foods = [
  {
    title: "炸兩",
    text: "腸粉捲住一條油炸鬼，淋豉油同芝麻。朝早同晏晝小店都有，熱辣辣食最好。唔係大澳獨有，不過行完棚屋坐低食一件，剛剛好。",
  },
  {
    title: "蝦醬同鹹魚",
    text: "大澳最出名係蝦醬。銀蝦發酵再曬，炒通菜、蒸肉餅都得。鹹魚係漁港留下來嘅保存方法，蒸飯上面一角已經好香。味道咸同腥，第一次試可以叫小碟，唔使一嚟就買一大樽。",
  },
  {
    title: "豆腐花",
    text: "滑豆腐花配薑糖水或者糖漿，行完市集當甜品。檔口通常一小碗，企住食都得。夏天當涼品，冬天當暖胃。",
  },
  {
    title: "蛋散、龍鬚糖",
    text: "蛋散薄而脆，龍鬚糖係拉到好幼嘅糖絲，包住花生或者椰絲。兩樣都係手信，當住你面整嘅檔口最熱鬧。糖食怕潮，當日食或者返到屋企先開袋。",
  },
] as const;

const stops = [
  {
    time: "09:30",
    title: "落到大澳",
    text: "當你已經喺巴士總站。先望吓涌：潮水高，棚屋貼住水面；潮水低就多排木樁。手信等陣折返先買，免得成朝拎住一袋蝦醬行路。",
  },
  {
    time: "10:00",
    title: "行棚屋水鄉",
    text: "沿涌邊行入棚屋區，行慢啲，巷窄，行開少少畀街坊。想坐小艇就喺碼頭問當日船期同價錢。唔坐船都唔算白行。",
  },
  {
    time: "11:30",
    title: "楊侯古廟",
    text: "由棚屋行去吉慶後街寶珠潭。廟大約朝早七點開到下晝五點，出發當日再對一次。入去靜啲，影完相可以喺廟前坐一陣，再沿水邊行返大街。",
  },
  {
    time: "12:30",
    title: "晏晝食飯",
    text: "想試本地味就叫蝦醬炒通菜，加一碟蒸魚或者肉餅。食得清淡可以揀炸兩或者粉麵。夏天檔口熱，揀有風扇嘅舖頭。",
  },
  {
    time: "14:00",
    title: "漁村市集同手信街",
    text: "食完飯先買手信。街市睇鮮貨，手信舖比較蝦醬、鹹魚同魚乾。貴嘅唔一定好，包裝完整、日期清楚先至要。",
  },
  {
    time: "15:15",
    title: "豆腐花同糖食",
    text: "豆腐花、蛋散、龍鬚糖揀一樣已經夠甜。糖食分返嚟食，唔好一路行一路拆晒。",
  },
  {
    time: "16:00",
    title: "再行一次水邊",
    text: "如果仲有腳力，行返涌邊。下晝側光，鐵皮同木樁會暖色啲。夏天呢個鐘數未到日落，想追日落要留到更夜，呢份行程就唔計入去。",
  },
  {
    time: "17:00",
    title: "搭車離開",
    text: "返巴士總站。去東涌、梅窩定係等街渡，睇返你朝早點嚟。週末人多，預多時間排隊。呢個鐘數係離開大澳，返到市區仲要一段車程。",
  },
] as const;

const credits = [
  {
    subject: "棚屋同小艇",
    author: "Maklinchi",
    license: "公有領域",
    href: "https://commons.wikimedia.org/wiki/File:Stilt_houses_Tai_O.jpg",
  },
  {
    subject: "棚屋水鄉",
    author: "Enochlau",
    license: "CC BY-SA 3.0",
    href: "https://commons.wikimedia.org/wiki/File:Tai_O_stilt_houses.jpg",
  },
  {
    subject: "楊侯古廟",
    author: "方畢可",
    license: "CC0",
    href: "https://commons.wikimedia.org/wiki/File:Yeung_Hau_Temple_in_Tai_O.jpg",
  },
  {
    subject: "大澳街市",
    author: "LN9267",
    license: "CC BY-SA 4.0",
    href: "https://commons.wikimedia.org/wiki/File:Tai_O_Market_25-11-2023.jpg",
  },
] as const;

function Photo({
  src,
  alt,
  width,
  height,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
}) {
  return (
    // publicPath already includes the GitHub Pages prefix. next/image would add it again.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} width={width} height={height} />
  );
}

export function Guide() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>("history");

  useEffect(() => {
    const nodes = NAV.map((item) => document.getElementById(item.id)).filter(
      (node): node is HTMLElement => node !== null,
    );
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActive(visible.target.id);
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.25, 0.6] },
    );

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <a className="skip" href="#history">
        跳去內容
      </a>
      <header className="topnav">
        <a className="brand" href="#top">
          大澳
        </a>
        <button
          type="button"
          className="nav-toggle"
          aria-expanded={open}
          aria-controls="tai-o-nav"
          onClick={() => setOpen((value) => !value)}
        >
          目錄
        </button>
        <nav id="tai-o-nav" className={open ? "nav-links is-open" : "nav-links"} aria-label="頁面章節">
          {NAV.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              aria-current={active === item.id ? "true" : undefined}
              onClick={(event) => {
                event.preventDefault();
                setActive(item.id);
                const target = document.getElementById(item.id);
                window.setTimeout(() => {
                  setOpen(false);
                  if (!target) return;
                  const nav = document.querySelector(".topnav");
                  const offset = (nav instanceof HTMLElement ? nav.offsetHeight : 64) + 12;
                  const heading = target.querySelector("h2") ?? target;
                  const top = heading.getBoundingClientRect().top + window.scrollY - offset;
                  const root = document.documentElement;
                  const previous = root.style.scrollBehavior;
                  root.style.scrollBehavior = "auto";
                  window.scrollTo({ top: Math.max(0, top), left: 0 });
                  root.style.scrollBehavior = previous;
                  window.history.pushState(null, "", `#${item.id}`);
                }, 0);
              }}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </header>

      <section className="hero" id="top">
        <Photo {...photos.stilts} />
        <div className="hero-shade" aria-hidden="true" />
        <div className="hero-copy">
          <p className="eyebrow">大嶼山西北 · 鹽田同漁港</p>
          <h1>大澳</h1>
          <p className="hero-lead">棚屋、古廟、蝦醬同鹹魚。一條涌，由朝早行到下晝。</p>
          <a className="hero-cta" href="#itinerary">
            睇一日行程
          </a>
        </div>
      </section>

      <section id="history" className="band">
        <div className="wrap history">
          <div>
            <p className="kicker">歷史</p>
            <h2>水上人嘅涌，而家仲有人住</h2>
            <p>
              大澳喺大嶼山西面。一條涌由山流出海，村就圍住呢條涌起。舊時呢度係鹽場同漁港：鹽田沿住涌口鋪開，漁船出海之前喺村裡補網、曬魚。水上人喺涌邊打木樁，上面搭棚屋。漲潮嘅時候，屋好似浮喺水面。
            </p>
            <p>
              漁獲一年少過一年，製鹽亦早已經停咗。二零零零年棚屋區失過一場大火，之後有一批棚屋重新起過，所以而家見到嘅水鄉有木有鐵，有新有舊。大澳仲係有人住嘅村。行街行開少少畀街坊，棚屋巷係人哋屋企，影相就係，唔好撞門入去。
            </p>
          </div>
          <aside className="history-note">
            <p>舊時</p>
            <strong>鹽田、漁港、棚屋</strong>
            <p>而家仲喺度嘅，係涌、廟，同街坊日日行嘅市集。</p>
          </aside>
        </div>
      </section>

      <section id="spots" className="band band-foam">
        <div className="wrap">
          <p className="kicker">景點</p>
          <h2>三個值得停低嘅位</h2>
          <div className="spot-list">
            {spots.map((spot) => (
              <article className="spot" key={spot.title}>
                <figure className="spot-photo">
                  <Photo {...spot.photo} />
                </figure>
                <div>
                  <h3>{spot.title}</h3>
                  <p>{spot.text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="food" className="band band-sand">
        <div className="wrap">
          <p className="kicker">食物</p>
          <h2>咸、香、甜，都係村裡嘅味</h2>
          <div className="food-grid">
            {foods.map((food) => (
              <article className="food" key={food.title}>
                <h3>{food.title}</h3>
                <p>{food.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="itinerary" className="band">
        <div className="wrap">
          <p className="kicker">一日遊</p>
          <h2>九點半入村，五點離開</h2>
          <p className="lede">
            以下當你大約 09:30 已經喺大澳巴士總站，17:00 之前搭車走。通常由東涌站轉新大嶼山巴士（平時多數係 11 號）過去，車程大約四五十分鐘，所以要再早一個鐘出門。梅窩亦有巴士，屯門有街渡，班次疏啲。船期同巴士會改，出發當日先對時間。
          </p>
          <ul className="prep">
            <li>帶水、帽同防曬。夏天路面熱，冬天海風大。</li>
            <li>著行得嘅鞋。石級同木橋落雨會滑。</li>
            <li>小檔口現金穩陣啲。小店休息日唔統一，想食特定一間先查吓。</li>
          </ul>
          <ol className="timeline">
            {stops.map((stop) => (
              <li key={stop.time}>
                <time dateTime={stop.time}>{stop.time}</time>
                <div>
                  <h3>{stop.title}</h3>
                  <p>{stop.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <footer className="colophon">
        <div className="wrap">
          <p>大澳旅遊指南 · 香港水鄉一日遊。時間同價錢會變，當日先算。</p>
          <p>相片出處係 Wikimedia Commons：</p>
          <ul>
            {credits.map((credit) => (
              <li key={credit.href}>
                {credit.subject}：{credit.author}，{credit.license}，
                <a href={credit.href}>檔案頁</a>
              </li>
            ))}
          </ul>
        </div>
      </footer>
    </>
  );
}
