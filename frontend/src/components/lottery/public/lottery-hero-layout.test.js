import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const hero = read("./LotteryCampaignHero.jsx");
const css = read("./lottery-public.css");
const page = read("./LotteryPublicPage.jsx");

test("campaign artwork leads the compact text and loads eagerly", () => {
  assert.ok(hero.indexOf('className="lottery-hero__media"') < hero.indexOf("<Title>"));
  assert.match(hero, /loading="eager"/);
  assert.match(hero, /fetchPriority="high"/);
  assert.match(hero, /alt=\{`\$\{title\}活动主题图`\}/);
  assert.doesNotMatch(hero, /<PrizeImage/);
});

test("absent or broken artwork leaves no large placeholder and duplicate copy is omitted", () => {
  assert.match(hero, /imageUrl && imageUrl !== failedImage/);
  assert.match(hero, /onError=\{\(\) => setFailedImage\(imageUrl\)\}/);
  assert.match(hero, /const showDescription = description &&/);
  assert.match(hero, /showDescription \? <Paragraph>/);
});

test("hero image is full-width, uncropped and title is smaller on narrow screens", () => {
  assert.match(css, /\.lottery-hero__media\s*\{[^}]*width: 100%/);
  assert.match(css, /\.lottery-hero__media img\s*\{[^}]*width: 100%; height: auto;[^}]*object-fit: contain/);
  assert.match(css, /font-size: clamp\(18px, 4\.7vw, 22px\)/);
  assert.doesNotMatch(css, /\.lottery-hero__(?:body|image)\s*\{/);
});

test("hero stays between the top winners banner and the draw controls", () => {
  assert.ok(page.indexOf("<LotteryWinnersFeed") < page.indexOf('<header className="lottery-hero">'));
  assert.ok(page.indexOf("<LotteryCampaignHero") < page.indexOf('className="lottery-chance-card"'));
  assert.match(page, /<LotteryCampaignHero campaign=\{campaign\} customerName=\{link.customer_name\} \/>/);
});
