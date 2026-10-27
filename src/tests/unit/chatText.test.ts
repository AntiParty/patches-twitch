import { strict as assert } from 'assert';
import { stripInvisibleChars } from '@/util/chatText';

describe('stripInvisibleChars', () => {
  it('drops the Chatterino duplicate-bypass character so !rank has no args', () => {
    const cleaned = stripInvisibleChars('!rank ͏');
    assert.equal(cleaned, '!rank');
    assert.deepEqual(cleaned.split(' ').slice(1), []);
  });

  it('drops the 7TV tag character and zero-width spaces', () => {
    assert.equal(stripInvisibleChars('!rank lamp#5944 \u{E0000}'), '!rank lamp#5944');
    assert.equal(stripInvisibleChars('!r​ank'), '!rank');
  });

  it('keeps zero-width joiners inside emoji', () => {
    assert.equal(stripInvisibleChars('!editcmd rank hi 👨‍💻'), '!editcmd rank hi 👨‍💻');
  });
});
