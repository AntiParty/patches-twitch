import assert from 'assert';
import fs from 'fs';
import path from 'path';

describe('overlay themes', () => {
    const overlaysDir = path.join(process.cwd(), 'frontend', 'public', 'overlays');
    const dashboardPath = path.join(process.cwd(), 'frontend', 'views', 'user-dashboard.ejs');
    const dashboardHtml = fs.readFileSync(dashboardPath, 'utf8');

    it('exposes clean dark overlay options in the user dashboard', () => {
        [
            '<option value="dark">Dark Rail</option>',
            '<option value="dark-slim">Dark Rail Slim</option>',
            '<option value="rank-focus">Rank Focus</option>'
        ].forEach((expectedMarkup) => {
            assert.ok(
                dashboardHtml.includes(expectedMarkup),
                `Expected dashboard theme selector to include ${expectedMarkup}`
            );
        });
    });

    it('ships dark overlay files with the standard overlay endpoints', () => {
        ['dark.html', 'dark-slim.html', 'rank-focus.html'].forEach((fileName) => {
            const html = fs.readFileSync(path.join(overlaysDir, fileName), 'utf8');

            assert.ok(html.includes('/api/overlay/data/${TOKEN}'), `${fileName} should fetch overlay data`);
            assert.ok(html.includes('/api/overlay/config/${TOKEN}'), `${fileName} should fetch overlay config`);
            assert.ok(html.includes('IS_PREVIEW'), `${fileName} should support preview mode`);
            assert.ok(html.includes('applyVisibility'), `${fileName} should support field visibility`);
        });
    });

    it('renders the rank focus theme with an oversized rank icon integrated into the rail', () => {
        const html = fs.readFileSync(path.join(overlaysDir, 'rank-focus.html'), 'utf8');

        assert.ok(html.includes('class="rank-emblem"'), 'rank-focus should include a dedicated emblem surface');
        assert.ok(html.includes('id="rank-icon"'), 'rank-focus should render the standard rank icon');
        assert.ok(html.includes('linear-gradient(90deg'), 'rank-focus should blend the icon surface into the rail');
    });

    it('keeps the rank focus icon free of any background plate', () => {
        const html = fs.readFileSync(path.join(overlaysDir, 'rank-focus.html'), 'utf8');
        const emblemBlock = html.match(/\.rank-emblem\s*\{[\s\S]*?\n    \}/)?.[0] || '';
        const blendBlock = html.match(/\.rank-emblem::after\s*\{[\s\S]*?\n    \}/)?.[0] || '';

        assert.ok(!emblemBlock.includes('var(--accent-rgb)'), 'rank emblem background should not use accent color washes');
        assert.ok(emblemBlock.includes('background: transparent;'), 'rank emblem should not render a visible background');
        assert.ok(emblemBlock.includes('box-shadow: none;'), 'rank emblem should not render a shadow plate');
        assert.ok(blendBlock.includes('display: none;'), 'rank emblem should not render a blend strip behind the icon');
    });

    it('uses a transparent rail feather to blend into the rank icon', () => {
        const html = fs.readFileSync(path.join(overlaysDir, 'rank-focus.html'), 'utf8');
        const railBlendBlock = html.match(/\.stats-rail::before\s*\{[\s\S]*?\n    \}/)?.[0] || '';

        assert.ok(railBlendBlock.includes('left: -24px;'), 'rail blend should extend toward the rank icon');
        assert.ok(railBlendBlock.includes('linear-gradient(90deg, transparent'), 'rail blend should feather in from transparent');
        assert.ok(railBlendBlock.includes('z-index: -1;'), 'rail blend should sit below the icon layer');
    });

    it('animates rank focus session gains with a clean directional gain state', () => {
        const html = fs.readFileSync(path.join(overlaysDir, 'rank-focus.html'), 'utf8');

        assert.ok(html.includes('@keyframes sessionGain'), 'rank-focus should define a dedicated gain animation');
        assert.ok(html.includes('.session-gain'), 'rank-focus should expose a session gain animation class');
        assert.ok(html.includes('let prevSessionChange = null;'), 'rank-focus should track previous session change');
        assert.ok(html.includes("sessEl.classList.add('session-gain');"), 'rank-focus should apply gain animation only for increases');
        assert.ok(html.includes('change > prevSessionChange'), 'rank-focus should detect upward session movement');
    });
});
