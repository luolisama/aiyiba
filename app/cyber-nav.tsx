import Link from "next/link";
import type { ReactNode } from "react";
import ThemeToggle from "./theme-toggle";

const GAME_LINKS = [
  { href: "/solo", label: "经典推理", short: "经典" },
  { href: "/clues", label: "线索阶梯", short: "线索" },
  { href: "/timeline", label: "时光机", short: "时光机" },
  { href: "/multi", label: "多人模式", short: "多人" },
] as const;

type GamePath = (typeof GAME_LINKS)[number]["href"];

type GameModeNavProps = {
  activePath?: GamePath;
  className: string;
};

function GameModeNav({ activePath, className }: GameModeNavProps) {
  return (
    <nav className={className} aria-label="切换玩法">
      {GAME_LINKS.map((item) => (
        <Link key={item.href} href={item.href} aria-current={item.href === activePath ? "page" : undefined}>
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}

type GameMobileMenuProps = {
  activePath?: GamePath;
  className: string;
};

function GameMobileMenu({ activePath, className }: GameMobileMenuProps) {
  return (
    <details className={className}>
      <summary aria-label="玩法菜单"><span /><span /><span /></summary>
      <nav aria-label="移动端玩法菜单">
        <Link href="/" aria-current={activePath === undefined ? "page" : undefined}>首页</Link>
        {GAME_LINKS.map((item) => (
          <Link key={item.href} href={item.href} aria-current={item.href === activePath ? "page" : undefined}>{item.short}</Link>
        ))}
      </nav>
    </details>
  );
}

type CyberBrandProps = {
  suffix?: string;
  linked?: boolean;
};

export function CyberBrand({ suffix, linked = true }: CyberBrandProps) {
  const content = (
    <>
      <span className="brand-note" aria-hidden="true"><span>哎</span></span>
      <span className="brand-copy"><strong>哎一把</strong>{suffix && <small>{suffix}</small>}</span>
    </>
  );
  return linked
    ? <Link className="brand cyber-brand" href="/" aria-label="返回哎一把主页">{content}</Link>
    : <div className="brand cyber-brand" aria-label="哎一把">{content}</div>;
}

type GameTopBarProps = {
  activePath: GamePath;
  modeLabel: string;
  children?: ReactNode;
  className?: string;
};

export function GameTopBar({ activePath, modeLabel, children, className = "" }: GameTopBarProps) {
  return (
    <>
      <header className={`topbar cyber-topbar ${className}`.trim()}>
        <CyberBrand suffix={modeLabel} />
        <GameModeNav activePath={activePath} className="cyber-mode-nav" />
        <div className="header-actions cyber-header-actions">{children}<ThemeToggle /></div>
        <GameMobileMenu activePath={activePath} className="cyber-mobile-menu" />
      </header>
      <header className={`topbar classic-topbar ${className}`.trim()}>
        <Link className="brand" href="/" aria-label="返回哎一把主页">
          <span className="brand-note" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ilem-avatar.jpg" alt="ilem头像" />
          </span>
          <span>哎一把 · {modeLabel}</span>
        </Link>
        <GameModeNav activePath={activePath} className="classic-mode-nav" />
        <nav className="header-actions" aria-label="辅助功能">
          {children}
          <ThemeToggle />
        </nav>
        <GameMobileMenu activePath={activePath} className="classic-mobile-menu" />
      </header>
    </>
  );
}

export function HomeTopBar() {
  return (
    <>
      <header className="topbar home-topbar cyber-topbar">
        <CyberBrand linked={false} />
        <GameModeNav className="cyber-mode-nav home-mode-nav" />
        <div className="home-header-actions"><ThemeToggle /><Link className="home-rules-link" href="/solo">开始猜歌</Link></div>
        <GameMobileMenu className="cyber-mobile-menu" />
      </header>
      <header className="topbar home-topbar classic-topbar">
        <div className="brand" aria-label="哎一把">
          <a className="brand-note" href="https://space.bilibili.com/3379951" target="_blank" rel="noreferrer" aria-label="访问 ilem B站个人主页">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ilem-avatar.jpg" alt="ilem头像" />
          </a>
          <span>哎一把</span>
        </div>
        <GameModeNav className="classic-mode-nav home-mode-nav" />
        <div className="home-header-actions"><ThemeToggle /><Link className="home-rules-link" href="/solo">开始猜歌</Link></div>
        <GameMobileMenu className="classic-mobile-menu" />
      </header>
    </>
  );
}
