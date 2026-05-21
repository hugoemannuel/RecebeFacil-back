import { Test, TestingModule } from '@nestjs/testing';
import { ZapiWebhookService } from './zapi-webhook.service';
import { PrismaService } from '../prisma/prisma.service';
import { ZapiMessageDto } from './dto/zapi-message.dto';

const makePayload = (overrides: Partial<ZapiMessageDto> = {}): ZapiMessageDto => ({
  phone: '5511999999999@c.us',
  type: 'ReceivedCallback',
  fromMe: false,
  text: { message: 'PARAR' },
  ...overrides,
});

describe('ZapiWebhookService', () => {
  let service: ZapiWebhookService;

  const mockPrisma = {
    user:     { findUnique: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZapiWebhookService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<ZapiWebhookService>(ZapiWebhookService);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(service).toBeDefined());

  // ─── PARAR ──────────────────────────────────────────────────────
  describe('opt-out', () => {
    it('deve registrar opt-out quando devedor envia PARAR', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', whatsapp_opted_out: false });
      mockPrisma.user.update.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      await service.handle(makePayload());

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { whatsapp_opted_out: true },
      });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'WHATSAPP_OPT_OUT' }) }),
      );
    });

    it('deve normalizar "parar" (minúsculas) como opt-out', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', whatsapp_opted_out: false });
      mockPrisma.user.update.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      await service.handle(makePayload({ text: { message: 'parar' } }));

      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('deve aceitar STOP como opt-out', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', whatsapp_opted_out: false });
      mockPrisma.user.update.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      await service.handle(makePayload({ text: { message: 'STOP' } }));

      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('deve ignorar mensagem que não é keyword de opt-out', async () => {
      await service.handle(makePayload({ text: { message: 'Olá, tudo bem?' } }));
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('deve ignorar mensagem enviada por nós (fromMe=true)', async () => {
      await service.handle(makePayload({ fromMe: true }));
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('deve ignorar tipo que não é ReceivedCallback', async () => {
      await service.handle(makePayload({ type: 'StatusCallback' }));
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('deve ignorar número não cadastrado', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await service.handle(makePayload());

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('não deve duplicar opt-out se já está ativo', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', whatsapp_opted_out: true });

      await service.handle(makePayload());

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('deve remover sufixo @c.us do número ao buscar no banco', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await service.handle(makePayload({ phone: '5511999999999@c.us' }));

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { phone: '5511999999999' } });
    });

    it('deve remover sufixo @s.whatsapp.net do número', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await service.handle(makePayload({ phone: '5511999999999@s.whatsapp.net' }));

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { phone: '5511999999999' } });
    });
  });
});
