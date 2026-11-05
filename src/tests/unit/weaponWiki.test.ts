import { strict as assert } from 'assert';
import {
  detectBurstSize,
  fitMeleeCadence,
  parseDamage,
  parseDamageProfile,
  parseHeadshotMult,
  parseInfobox,
  parseMeleeHits,
  parseRpmList,
  parseWeaponList,
  parseWeaponPage,
  voteClassHealth,
} from '@/services/weaponWiki.service';

// Short excerpts in the shape of thefinals.wiki pages (CC BY-SA 4.0), trimmed to the lines we parse.
const FAMAS = `{{Infobox weapons
| name = FAMAS
| build = Medium
| wtype = Assault Rifle
| bodydamage = 24
| crit = 36 (1.5×)
| falloffmin = 33.5m
| falloffmax = 42.5m
| falloffmulti = 0.50
| rpm = 220｜1080
| magsize = 27
| fullreload = 2.40s
}}
The trigger can be pulled to fire a burst of three bullets that damage opponents.`;

const CL40 = `{{Infobox weapons
|name=CL-40
|build= Medium
|wtype= Grenade Launcher
|bodydamage=Direct - 105 <br>Splash- from 79 to 11
|rpm=73
|magsize=5
|fullreload=4.75s}}
Body text.`;

const DAGGER = `{{Infobox weapons
| name = DAGGER
| build = Light
| wtype = Melee
| primaryfire = Precise - 70 <br>Glancing blow - 49
| altfire = Precise - 90<br>Backstab - 315
}}
===Damage Profile===
{| class="wikitable"
! rowspan="2" | Body Part
! colspan="2" | Light (175 HP)
! colspan="2" | Medium (250 HP)
|-
! Hits to kill
! Time to kill (s)
! Hits to kill
! Time to kill (s)
|-
| Body
| 3
| 0.80
| 4
| 1.20
|-
| Body (Alt-Fire)
| 2
| 0.50
| 3
| 0.90
|}`;

describe('weaponWiki', () => {
  describe('parseInfobox', () => {
    it('reads key/value pairs and handles the closing braces on the last value line', () => {
      const ib = parseInfobox(CL40)!;
      assert.equal(ib.name, 'CL-40');
      assert.equal(ib.fullreload, '4.75s');
      assert.equal(ib.rpm, '73');
    });

    it('keeps nested templates and links inside a value', () => {
      const ib = parseInfobox('{{Infobox weapons\n| weaponquote = {{Quote|text=Fast}}\n| tacreload = [[#Seg|Segmented]]\n| rpm = 90\n}}')!;
      assert.equal(ib.weaponquote, '{{Quote|text=Fast}}');
      assert.equal(ib.rpm, '90');
    });

    it('returns null without an infobox', () => {
      assert.equal(parseInfobox('Just prose.'), null);
    });
  });

  describe('field parsers', () => {
    it('parses crit with an explicit multiplier', () => {
      assert.equal(parseHeadshotMult('37.5 (1.5×)', 25), 1.5);
    });
    it('falls back to crit / body damage', () => {
      assert.equal(parseHeadshotMult('50', 25), 2);
      assert.equal(parseHeadshotMult(undefined, 25), null);
    });
    it('splits rpm lists on the full-width and CJK bars', () => {
      assert.deepEqual(parseRpmList('220｜1080'), [220, 1080]);
      assert.deepEqual(parseRpmList('89丨545.45丨27.7'), [89, 545.45, 27.7]);
      assert.deepEqual(parseRpmList('500'), [500]);
    });
    it('parses pellet damage', () => {
      assert.deepEqual(parseDamage('13×9 (Max - 117)'), { damage: 13, projectiles: 9 });
      assert.deepEqual(parseDamage('25'), { damage: 25, projectiles: 1 });
    });
    it('parses explosive direct damage', () => {
      assert.deepEqual(parseDamage('Direct - 105 <br>Splash- from 79 to 11'), { damage: 105, projectiles: 1 });
    });
    it('detects burst size from prose', () => {
      assert.equal(detectBurstSize('fire a burst of three bullets'), 3);
      assert.equal(detectBurstSize('fire two knives'), 2);
      assert.equal(detectBurstSize('fires once'), 1);
    });
    it('parses melee hit lists', () => {
      assert.deepEqual(parseMeleeHits('Precise - 70 <br>Glancing blow - 49'), [
        { label: 'Precise', damage: 70, projectiles: 1 },
        { label: 'Glancing', damage: 49, projectiles: 1 },
      ]);
    });
  });

  describe('parseWeaponPage', () => {
    it('reads a burst weapon: rpm after the burst, burst rpm and size', () => {
      const w = parseWeaponPage('FAMAS', FAMAS)!;
      const m = w.modes[0];
      assert.equal(w.build, 'Medium');
      assert.equal(m.damage, 24);
      assert.equal(m.headshotMult, 1.5);
      assert.equal(m.rpm, 220);
      assert.equal(m.burstRpm, 1080);
      assert.equal(m.burstSize, 3);
      assert.equal(w.magSize, 27);
      assert.equal(w.reloadS, 2.4);
      assert.equal(w.falloffMinM, 33.5);
      assert.equal(w.falloffMult, 0.5);
    });

    it('adds a splash mode for explosives', () => {
      const w = parseWeaponPage('CL-40', CL40)!;
      assert.deepEqual(w.modes.map((m) => [m.label, m.damage]), [['Direct', 105], ['Splash', 79]]);
    });

    it('multiplies coupled magazines ("30×2") and notes it', () => {
      const w = parseWeaponPage('ARN-220', '{{Infobox weapons\n| bodydamage = 20\n| rpm = 600\n| magsize = 30×2\n}}')!;
      assert.equal(w.magSize, 60);
      assert.equal(w.notes.length, 1);
    });

    it('treats an infinite magazine as no reload', () => {
      const w = parseWeaponPage('Flamethrower', '{{Infobox weapons\n| bodydamage = 10\n| rpm = 600\n| magsize = ∞\n}}')!;
      assert.equal(w.magSize, null);
    });

    it('builds melee primary and alt-fire modes with fitted cadence', () => {
      const w = parseWeaponPage('Dagger', DAGGER)!;
      assert.deepEqual(
        w.modes.map((m) => m.label),
        ['Precise', 'Glancing', 'Precise (Alt-Fire)', 'Backstab (Alt-Fire)'],
      );
      assert.equal(w.magSize, null);
      assert.ok(w.modes[0].rpm! > 0);
      assert.ok(w.modes[0].firstIntervalS! > 0);
    });

    it('returns null when there is no damage information', () => {
      assert.equal(parseWeaponPage('Nothing', '{{Infobox weapons\n| name = Nothing\n}}'), null);
    });
  });

  describe('damage profile', () => {
    it('reads class health and rows', () => {
      const p = parseDamageProfile(DAGGER)!;
      assert.deepEqual(p.health, { Light: 175, Medium: 250 });
      assert.deepEqual(p.rows[0].points[1], { build: 'Medium', hits: 4, seconds: 1.2 });
    });

    it('accepts pipes escaped as {{!}} inside the table', () => {
      const text = '===Damage Profile===\n{| class="wikitable"\n! Light (175 HP)\n|-\n{{!}} Body\n{{!}} 1\n{{!}} 0.5\n|}';
      const p = parseDamageProfile(text)!;
      assert.equal(p.health.Light, 175);
      assert.equal(p.rows[0].points[0].hits, 1);
    });

    it('returns null without a Damage Profile section', () => {
      assert.equal(parseDamageProfile('no table here'), null);
    });

    it('fits melee cadence from kill times', () => {
      // 2 hits in 0.5s, 4 hits in 1.3s => follow-up gap 0.4s.
      const fit = fitMeleeCadence([
        { label: 'Body', points: [
          { build: 'Light', hits: 2, seconds: 0.5 },
          { build: 'Heavy', hits: 4, seconds: 1.3 },
        ] },
      ])!;
      assert.equal(fit.firstIntervalS, 0.5);
      assert.equal(fit.rpm, 150);
    });
  });

  describe('voteClassHealth', () => {
    const profile = (l: number, m: number, h: number) => ({ health: { Light: l, Medium: m, Heavy: h }, rows: [] });

    it('takes the most common value so stale pages are outvoted', () => {
      const health = voteClassHealth([profile(175, 250, 325), profile(175, 250, 325), profile(150, 250, 350), null])!;
      assert.deepEqual(health, { Light: 175, Medium: 250, Heavy: 325 });
    });

    it('returns null when a class has no data', () => {
      assert.equal(voteClassHealth([null]), null);
    });
  });

  describe('parseWeaponList', () => {
    it('collects unique page names from EquipmentCard entries', () => {
      const text = '{{EquipmentCard | page=AKM | image=a.png}}\n{{EquipmentCard|page = CB-01 Repeater|x=1}}\n{{EquipmentCard | page=AKM}}';
      assert.deepEqual(parseWeaponList(text), ['AKM', 'CB-01 Repeater']);
    });
  });
});
