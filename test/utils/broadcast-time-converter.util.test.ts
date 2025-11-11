import { format } from 'date-fns';
import { broadcastTimeConverter } from '@/utils/broadcast-time-converter.util';

describe('BroadcastTimeConverter', () => {
  describe('convertRadioTime', () => {
    it('24:00 を翌日 00:00 に変換', () => {
      const result = broadcastTimeConverter.convertRadioTime('20251111240000');
      expect(result).toBe('20251112000000');
    });

    it('25:30 を翌日 01:30 に変換', () => {
      const result = broadcastTimeConverter.convertRadioTime('20251111253000');
      expect(result).toBe('20251112013000');
    });

    it('29:00 を翌日 05:00 に変換', () => {
      const result = broadcastTimeConverter.convertRadioTime('20251111290000');
      expect(result).toBe('20251112050000');
    });

    it('通常の時刻（12:00）はそのまま', () => {
      const result = broadcastTimeConverter.convertRadioTime('20251111120000');
      expect(result).toBe('20251111120000');
    });

    it('23:59 はそのまま（翌日にならない）', () => {
      const result = broadcastTimeConverter.convertRadioTime('20251111235900');
      expect(result).toBe('20251111235900');
    });

    it('部分指定（2025111124）でも動作', () => {
      const result = broadcastTimeConverter.convertRadioTime('2025111124');
      expect(result).toBe('20251112000000');
    });
  });

  describe('convertRadioDateTime', () => {
    it('24:00 を DateTime に変換', () => {
      const result = broadcastTimeConverter.convertRadioDateTime('20251111240000');
      expect(format(result, 'yyyyMMddHHmmss')).toBe('20251112000000');
    });

    it('25:30 を DateTime に変換', () => {
      const result = broadcastTimeConverter.convertRadioDateTime('20251111253000');
      expect(format(result, 'yyyyMMddHHmmss')).toBe('20251112013000');
    });
  });
});
