import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

const VALID_KEY = 'a'.repeat(64); // 64 chars hex = 32 bytes

const mockConfigService = (key: string | undefined) => ({
  get: jest.fn((k: string) => (k === 'ENCRYPTION_KEY' ? key : null)),
});

describe('CryptoService', () => {
  let service: CryptoService;

  async function buildService(hexKey: string) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CryptoService,
        { provide: ConfigService, useValue: mockConfigService(hexKey) },
      ],
    }).compile();
    return module.get<CryptoService>(CryptoService);
  }

  beforeEach(async () => {
    service = await buildService(VALID_KEY);
  });

  it('deve estar definido', () => expect(service).toBeDefined());

  // ─── Inicialização ────────────────────────────────────────────
  describe('inicialização', () => {
    it('deve lançar erro quando ENCRYPTION_KEY está ausente', async () => {
      await expect(buildService(undefined as any)).rejects.toThrow(
        'ENCRYPTION_KEY deve ser uma string hexadecimal de 64 caracteres',
      );
    });

    it('deve lançar erro quando ENCRYPTION_KEY tem comprimento inválido (< 64)', async () => {
      await expect(buildService('abc123')).rejects.toThrow(
        'ENCRYPTION_KEY deve ser uma string hexadecimal de 64 caracteres',
      );
    });

    it('deve lançar erro quando ENCRYPTION_KEY tem comprimento inválido (> 64)', async () => {
      await expect(buildService('a'.repeat(65))).rejects.toThrow(
        'ENCRYPTION_KEY deve ser uma string hexadecimal de 64 caracteres',
      );
    });
  });

  // ─── encrypt / decrypt (round-trip) ──────────────────────────
  describe('encrypt + decrypt', () => {
    it('deve retornar o plaintext original após round-trip', () => {
      const plaintext = 'minha_api_key_secreta_123';
      const ciphertext = service.encrypt(plaintext);
      expect(service.decrypt(ciphertext)).toBe(plaintext);
    });

    it('deve funcionar com chaves de API do Asaas (formato real)', () => {
      const apiKey = '$aact_YTU5YTE0M2M2N2I4MTliNjk0YTI5N2U5MjU5Y2I3Y2Q';
      const ciphertext = service.encrypt(apiKey);
      expect(service.decrypt(ciphertext)).toBe(apiKey);
    });

    it('deve funcionar com strings longas', () => {
      const longString = 'x'.repeat(1000);
      expect(service.decrypt(service.encrypt(longString))).toBe(longString);
    });

    it('deve produzir ciphertexts diferentes para o mesmo plaintext (IV aleatório)', () => {
      const plaintext = 'api_key_123';
      const c1 = service.encrypt(plaintext);
      const c2 = service.encrypt(plaintext);
      expect(c1).not.toBe(c2);
    });

    it('deve produzir ciphertexts diferentes para plaintexts diferentes', () => {
      const c1 = service.encrypt('api_key_1');
      const c2 = service.encrypt('api_key_2');
      expect(c1).not.toBe(c2);
    });
  });

  // ─── formato do ciphertext ────────────────────────────────────
  describe('formato do ciphertext', () => {
    it('deve produzir ciphertext com 3 partes separadas por ":"', () => {
      const ciphertext = service.encrypt('test');
      const parts = ciphertext.split(':');
      expect(parts).toHaveLength(3);
    });

    it('deve produzir IV de 24 chars hex (12 bytes)', () => {
      const parts = service.encrypt('test').split(':');
      expect(parts[0]).toHaveLength(24); // 12 bytes × 2 chars/byte
    });

    it('deve produzir authTag de 32 chars hex (16 bytes)', () => {
      const parts = service.encrypt('test').split(':');
      expect(parts[1]).toHaveLength(32); // 16 bytes × 2 chars/byte
    });
  });

  // ─── decrypt — entradas inválidas ────────────────────────────
  describe('decrypt — entradas inválidas', () => {
    it('deve lançar erro com ciphertext de formato inválido (sem ":")', () => {
      expect(() => service.decrypt('invalido')).toThrow('Formato de ciphertext inválido.');
    });

    it('deve lançar erro com ciphertext de formato inválido (só 2 partes)', () => {
      expect(() => service.decrypt('iv:tag')).toThrow('Formato de ciphertext inválido.');
    });

    it('deve lançar erro quando authTag foi adulterado (GCM verifica integridade)', () => {
      const ciphertext = service.encrypt('segredo');
      const parts = ciphertext.split(':');
      // Adulterar o authTag (segunda parte)
      const tampered = `${parts[0]}:${'ff'.repeat(16)}:${parts[2]}`;
      expect(() => service.decrypt(tampered)).toThrow();
    });

    it('deve lançar erro quando ciphertext foi adulterado', () => {
      const ciphertext = service.encrypt('segredo');
      const parts = ciphertext.split(':');
      // Adulterar o ciphertext (terceira parte)
      const tampered = `${parts[0]}:${parts[1]}:${'00'.repeat(parts[2].length / 2)}`;
      expect(() => service.decrypt(tampered)).toThrow();
    });
  });
});
