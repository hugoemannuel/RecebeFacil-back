import { Test, TestingModule } from '@nestjs/testing';
import { createHash } from 'crypto';
import { DemoService } from './demo.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

const mockPrisma = {
  demoAttempt: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
};

const mockWhatsApp = {
  sendText: jest.fn(),
};

describe('DemoService', () => {
  let service: DemoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DemoService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WhatsAppService, useValue: mockWhatsApp },
      ],
    }).compile();

    service = module.get<DemoService>(DemoService);
    jest.clearAllMocks();
  });

  it('envia mensagem na primeira tentativa e registra DemoAttempt', async () => {
    mockPrisma.demoAttempt.findUnique.mockResolvedValue(null);
    mockWhatsApp.sendText.mockResolvedValue(undefined);
    mockPrisma.demoAttempt.create.mockResolvedValue({});

    const result = await service.sendDemo(
      '1.2.3.4',
      '5511999999999',
      'João',
      'Olá *{{nome}}*! Bem-vindo ao RecebeFácil.',
    );

    expect(result).toEqual({ sent: true, blocked: false });
    expect(mockWhatsApp.sendText).toHaveBeenCalledWith(
      '5511999999999',
      'Olá *João*! Bem-vindo ao RecebeFácil.',
    );
    expect(mockPrisma.demoAttempt.create).toHaveBeenCalledWith({
      data: { ipHash: createHash('sha256').update('1.2.3.4').digest('hex') },
    });
  });

  it('bloqueia segunda tentativa do mesmo IP sem enviar mensagem', async () => {
    const ipHash = createHash('sha256').update('1.2.3.4').digest('hex');
    mockPrisma.demoAttempt.findUnique.mockResolvedValue({ id: '1', ipHash });

    const result = await service.sendDemo('1.2.3.4', '5511999999999', 'João', 'Olá!');

    expect(result).toEqual({ sent: false, blocked: true });
    expect(mockWhatsApp.sendText).not.toHaveBeenCalled();
    expect(mockPrisma.demoAttempt.create).not.toHaveBeenCalled();
  });

  it('não registra DemoAttempt se Z-API falhar', async () => {
    mockPrisma.demoAttempt.findUnique.mockResolvedValue(null);
    mockWhatsApp.sendText.mockRejectedValue(new Error('Falha ao enviar mensagem'));

    await expect(
      service.sendDemo('1.2.3.4', '5511999999999', 'João', 'Olá!'),
    ).rejects.toThrow('Falha ao enviar mensagem');

    expect(mockPrisma.demoAttempt.create).not.toHaveBeenCalled();
  });

  it('interpola {{nome}} com IPs distintos corretamente', async () => {
    mockPrisma.demoAttempt.findUnique.mockResolvedValue(null);
    mockWhatsApp.sendText.mockResolvedValue(undefined);
    mockPrisma.demoAttempt.create.mockResolvedValue({});

    await service.sendDemo(
      '5.6.7.8',
      '5511988887777',
      'Maria',
      'Oi *{{nome}}*! O {{nome}} pode pagar via PIX.',
    );

    expect(mockWhatsApp.sendText).toHaveBeenCalledWith(
      '5511988887777',
      'Oi *Maria*! O Maria pode pagar via PIX.',
    );
  });
});
