import { strict as assert } from 'assert';
import {
  bbToText,
  classFromName,
  mapStat,
  matchWeaponName,
  parseChangeLine,
  parsePatchNotes,
} from '@/services/patchNotes.service';

const WEAPONS = ['AKM', 'FCAR', 'Pike-556', 'R .357', 'CB-01 Repeater', 'M134 Minigun', 'M60', 'M11', 'M1A1'];

// Trimmed to the shape of Embark's 12.x announcements on Steam.
const NOTES = `[h2][b]GAME UPDATE [/b]| BALANCE CHANGES[/h2]
[p][i][b]Dev Note:[/b] We are tuning the assault rifles this week.[/i][/p]
[h3]Weapon[/h3]
[p][b]AKM[/b][/p]
[list][*][p]Increased magazine size from 34 to 36[/p][/*][/list]
[p][b]FCAR[/b][/p]
[list][*][p]Increased damage from 23 to 25[/p][/*]
[*][p]Decreased rate of fire from 530 to 500 RPM[/p][/*]
[*][p]Reduced the headshot multiplier from 1.5 to 1.4[/p][/*]
[*][p]Weapon feels snappier overall[/p][/*][/list]
[p][i][b]Dev Note:[/b] Pike was too strong at range.[/i][/p]

[b]Pike-556[/b][/p]
[list][*][p]Decreased damage from 22 to 20[/p][/*][/list]
[h3]Light[/h3]
[list][*][p]Increased health from 150 to 175[/p][/*][/list]
[h3]Gadgets[/h3]
[p][b]Frag Grenade[/b][/p]
[list][*][p]Decreased damage from 90 to 80[/p][/*][/list]
[h2][b]STORE [/b]| SETS[/h2]
[p][b]Some Set[/b][/p]
[list][*][p]Price lowered from 1000 to 800[/p][/*][/list]`;

describe('patchNotes', () => {
  describe('bbToText', () => {
    it('strips tags and collapses whitespace', () => {
      assert.equal(bbToText('[p]Increased  [b]damage[/b] from 1 to 2[/p]'), 'Increased damage from 1 to 2');
    });
    it('keeps link text', () => {
      assert.equal(bbToText('[url="https://x.test"]HERE[/url]'), 'HERE');
    });
  });

  describe('parseChangeLine', () => {
    it('reads "Increased X from A to B"', () => {
      const c = parseChangeLine('Increased damage from 23 to 25')!;
      assert.deepEqual([c.stat, c.from, c.to, c.qualifier], ['damage', 23, 25, '']);
    });

    it('reads present-tense verbs', () => {
      const c = parseChangeLine('Reduce reload time from 3.2s to 2.8s')!;
      assert.deepEqual([c.from, c.to, c.unit], [3.2, 2.8, 's']);
    });

    it('reads stat-first lines', () => {
      const c = parseChangeLine('Cooldown increased from 20s to 30s')!;
      assert.deepEqual([c.stat, c.from, c.to], ['Cooldown', 20, 30]);
    });

    it('keeps a qualifier prefix such as "Primary Attack"', () => {
      const c = parseChangeLine('Primary Attack: Increased base damage from 42 to 49')!;
      assert.equal(c.qualifier, 'Primary Attack');
      assert.equal(c.stat, 'base damage');
    });

    it('reads RPM units on either side', () => {
      const c = parseChangeLine('Decreased rate of fire from 530 to 500 RPM')!;
      assert.deepEqual([c.stat, c.from, c.to], ['rate of fire', 530, 500]);
    });

    it('returns null for prose', () => {
      assert.equal(parseChangeLine('Weapon feels snappier overall'), null);
    });
  });

  describe('mapStat', () => {
    it('maps weapon stats to field paths', () => {
      assert.equal(mapStat('damage', 'weapon'), 'damage');
      assert.equal(mapStat('rate of fire', 'weapon'), 'rpm');
      assert.equal(mapStat('headshot multiplier', 'weapon'), 'headshotMult');
      assert.equal(mapStat('magazine size', 'weapon'), 'magSize');
      assert.equal(mapStat('reload time', 'weapon'), 'reloadS');
      assert.equal(mapStat('cooldown', 'weapon'), null);
    });
    it('maps the falloff wordings Embark uses', () => {
      assert.equal(mapStat('damage falloff minimum range', 'weapon'), 'falloffMinM');
      assert.equal(mapStat('damage fall-off end range', 'weapon'), 'falloffMaxM');
      assert.equal(mapStat('damage falloff multiplier', 'weapon'), 'falloffMult');
      // FCAR, real line: "Decreased damage falloff modifier at max range from 67% to 55%"
      assert.equal(mapStat('damage falloff modifier at max range', 'weapon'), 'falloffMult');
    });
    it('turns a percentage falloff modifier into a multiplier', () => {
      const notes = '[h2]BALANCE CHANGES[/h2][h3]Weapon[/h3][p][b]FCAR[/b][/p][list][*][p]Decreased damage falloff modifier at max range from 67% to 55%[/p][/*][/list]';
      const [c] = parsePatchNotes(notes, WEAPONS).changes;
      assert.deepEqual([c.field, c.from, c.to], ['falloffMult', 0.67, 0.55]);
    });
    it('only understands health for classes', () => {
      assert.equal(mapStat('health', 'class'), 'health');
      assert.equal(mapStat('damage', 'class'), null);
    });
    it('does not map gadget lines', () => {
      assert.equal(mapStat('damage', 'other'), null);
    });
  });

  describe('classFromName', () => {
    it('normalises class names', () => {
      assert.equal(classFromName('Light'), 'Light');
      assert.equal(classFromName('heavy archetype'), 'Heavy');
      assert.equal(classFromName('AKM'), null);
    });
  });

  describe('parsePatchNotes', () => {
    const parsed = parsePatchNotes(NOTES, WEAPONS);
    const byTarget = (t: string) => parsed.changes.filter((c) => c.target === t);

    it('finds the balance section and stops at the next h2', () => {
      assert.equal(parsed.hasBalanceSection, true);
      assert.ok(!parsed.changes.some((c) => c.target === 'Some Set'));
    });

    it('does not read the bold "Dev Note:" in an italic paragraph as a target', () => {
      assert.ok(!parsed.changes.some((c) => /dev note/i.test(c.target)));
    });

    it('maps weapon lines and sets kind weapon', () => {
      const akm = byTarget('AKM');
      assert.equal(akm.length, 1);
      assert.deepEqual([akm[0].kind, akm[0].field, akm[0].from, akm[0].to], ['weapon', 'magSize', 34, 36]);
    });

    it('maps damage, rate of fire and headshot multiplier for one weapon', () => {
      const fields = byTarget('FCAR').map((c) => [c.field, c.from, c.to]);
      assert.deepEqual(fields, [['damage', 23, 25], ['rpm', 530, 500], ['headshotMult', 1.5, 1.4]]);
    });

    it('picks up a weapon heading that follows a dev note after a blank line (Pike case)', () => {
      const pike = byTarget('Pike-556');
      assert.equal(pike.length, 1);
      assert.deepEqual([pike[0].field, pike[0].from, pike[0].to], ['damage', 22, 20]);
    });

    it('reads class health under a class heading', () => {
      const light = parsed.changes.find((c) => c.kind === 'class')!;
      assert.deepEqual([light.target, light.field, light.from, light.to], ['Light', 'health', 150, 175]);
    });

    it('marks gadget lines as other with no field', () => {
      const frag = parsed.changes.find((c) => c.rawTarget === 'Frag Grenade')!;
      assert.equal(frag.kind, 'other');
      assert.equal(frag.field, null);
    });

    it('keeps lines without a numeric change as unparsed', () => {
      assert.deepEqual(parsed.unparsed.map((u) => u.line), ['Weapon feels snappier overall']);
      assert.equal(parsed.unparsed[0].target, 'FCAR');
    });

    it('stores the canonical weapon name and the raw name as written', () => {
      const p = parsePatchNotes(
        '[h2]BALANCE CHANGES[/h2][h3]Weapon[/h3][p][b]R.357[/b][/p][list][*][p]Increased damage from 40 to 45[/p][/*][/list]',
        WEAPONS
      );
      assert.equal(p.changes[0].target, 'R .357');
      assert.equal(p.changes[0].rawTarget, 'R.357');
    });

    it('treats an unknown name under Weapon as other when weapon names are supplied', () => {
      const p = parsePatchNotes(
        '[h2]BALANCE CHANGES[/h2][h3]Weapon[/h3][p][b]Mystery Gun[/b][/p][list][*][p]Increased damage from 1 to 2[/p][/*][/list]',
        WEAPONS
      );
      assert.equal(p.changes[0].kind, 'other');
    });

    it('falls back to the category heuristic without weapon names', () => {
      const p = parsePatchNotes(
        '[h2]BALANCE CHANGES[/h2][h3]Weapon[/h3][p][b]Mystery Gun[/b][/p][list][*][p]Increased damage from 1 to 2[/p][/*][/list]'
      );
      assert.equal(p.changes[0].kind, 'weapon');
    });

    it('leaves the field empty for secondary attack lines so a human picks the mode', () => {
      const p = parsePatchNotes(
        '[h2]BALANCE CHANGES[/h2][h3]Weapon[/h3][p][b]AKM[/b][/p][list]' +
          '[*][p]Secondary Attack: Increased damage from 10 to 12[/p][/*]' +
          '[*][p]Primary Attack: Increased damage from 20 to 22[/p][/*][/list]',
        WEAPONS
      );
      assert.equal(p.changes[0].field, null);
      assert.equal(p.changes[0].qualifier, 'Secondary Attack');
      assert.equal(p.changes[1].field, 'damage');
    });

    it('reports no balance section for other posts', () => {
      const p = parsePatchNotes('[h2]STORE[/h2][p]New set[/p]', WEAPONS);
      assert.equal(p.hasBalanceSection, false);
      assert.equal(p.changes.length, 0);
    });
  });

  describe('matchWeaponName', () => {
    it('matches exactly, ignoring case and punctuation', () => {
      assert.equal(matchWeaponName('akm', WEAPONS), 'AKM');
      assert.equal(matchWeaponName('R.357', WEAPONS), 'R .357');
    });
    it('matches a unique prefix', () => {
      assert.equal(matchWeaponName('CB-01', WEAPONS), 'CB-01 Repeater');
    });
    it('matches an alias', () => {
      assert.equal(matchWeaponName('Minigun', WEAPONS), 'M134 Minigun');
    });
    it('returns null when a prefix is ambiguous', () => {
      assert.equal(matchWeaponName('M1', ['M11', 'M1A1'])!, null);
    });
    it('returns null for unknown names', () => {
      assert.equal(matchWeaponName('Spoon', WEAPONS), null);
    });
  });
});
