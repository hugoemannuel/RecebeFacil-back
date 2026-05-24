import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

describe('IntegrationsController', () => {
  let controller: IntegrationsController;

  const mockService = {
    getSplitTerms: jest.fn(),
    acknowledgeSplitTerms: jest.fn(),
    getAutomationConfig: jest.fn(),
    updateAutomationConfig: jest.fn(),
    getZapiConfig: jest.fn(),
    updateZapiConfig: jest.fn(),
    disconnectZapi: jest.fn(),
    getFinanceBalance: jest.fn(),
    requestWithdrawal: jest.fn(),
    getWithdrawals: jest.fn(),
    getSplitStatus: jest.fn(),
  };

  const req = { user: { id: 'user-1' } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IntegrationsController],
      providers: [{ provide: IntegrationsService, useValue: mockService }],
    }).compile();
    controller = module.get<IntegrationsController>(IntegrationsController);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(controller).toBeDefined());

  it('getSplitTerms delega para service', async () => {
    mockService.getSplitTerms.mockResolvedValueOnce({ version: '1.0.0' });
    await controller.getSplitTerms();
    expect(mockService.getSplitTerms).toHaveBeenCalled();
  });

  it('acknowledgeSplit delega para service com userId', async () => {
    mockService.acknowledgeSplitTerms.mockResolvedValueOnce({});
    await controller.acknowledgeSplit(req as any, { version: '1.0.0' });
    expect(mockService.acknowledgeSplitTerms).toHaveBeenCalledWith('user-1', { version: '1.0.0' });
  });

  it('getAutomation delega para service', async () => {
    mockService.getAutomationConfig.mockResolvedValueOnce({});
    await controller.getAutomation(req as any);
    expect(mockService.getAutomationConfig).toHaveBeenCalledWith('user-1');
  });

  it('updateAutomation delega para service', async () => {
    const dto: any = { allows_automation: false };
    mockService.updateAutomationConfig.mockResolvedValueOnce({});
    await controller.updateAutomation(req as any, dto);
    expect(mockService.updateAutomationConfig).toHaveBeenCalledWith('user-1', dto);
  });

  it('getZapi delega para service', async () => {
    mockService.getZapiConfig.mockResolvedValueOnce({ has_credentials: true });
    await controller.getZapi(req as any);
    expect(mockService.getZapiConfig).toHaveBeenCalledWith('user-1');
  });

  it('updateZapi delega para service com userId e dto', async () => {
    const dto: any = { instance_id: 'i1', instance_token: 't1' };
    mockService.updateZapiConfig.mockResolvedValueOnce({});
    await controller.updateZapi(req as any, dto);
    expect(mockService.updateZapiConfig).toHaveBeenCalledWith('user-1', dto);
  });

  it('disconnectZapi delega para service', async () => {
    mockService.disconnectZapi.mockResolvedValueOnce({});
    await controller.disconnectZapi(req as any);
    expect(mockService.disconnectZapi).toHaveBeenCalledWith('user-1');
  });

  it('getFinanceBalance delega para service com userId', async () => {
    mockService.getFinanceBalance.mockResolvedValueOnce({ balance: 200, hasSubaccount: true });
    const result = await controller.getFinanceBalance(req as any);
    expect(mockService.getFinanceBalance).toHaveBeenCalledWith('user-1');
    expect(result.balance).toBe(200);
  });

  it('requestWithdrawal delega para service com userId e dto', async () => {
    const dto: any = { value: 50, pixKey: 'cpf', pixKeyType: 'CPF', idempotencyKey: 'uuid-1' };
    mockService.requestWithdrawal.mockResolvedValueOnce({ id: 'wr-1', status: 'PROCESSING' });
    const result = await controller.requestWithdrawal(req as any, dto);
    expect(mockService.requestWithdrawal).toHaveBeenCalledWith('user-1', dto);
    expect(result.status).toBe('PROCESSING');
  });

  it('getWithdrawals delega para service com paginação padrão', async () => {
    mockService.getWithdrawals.mockResolvedValueOnce({ records: [], total: 0, page: 1, limit: 10, pages: 0 });
    await controller.getWithdrawals(req as any);
    expect(mockService.getWithdrawals).toHaveBeenCalledWith('user-1', 1, 10);
  });

  it('getWithdrawals repassa page e limit quando fornecidos', async () => {
    mockService.getWithdrawals.mockResolvedValueOnce({ records: [], total: 0, page: 2, limit: 5, pages: 0 });
    await controller.getWithdrawals(req as any, '2', '5');
    expect(mockService.getWithdrawals).toHaveBeenCalledWith('user-1', 2, 5);
  });

  it('getSplitStatus delega para service com userId', async () => {
    mockService.getSplitStatus.mockResolvedValueOnce({ accepted: true });
    const result = await controller.getSplitStatus(req as any);
    expect(mockService.getSplitStatus).toHaveBeenCalledWith('user-1');
    expect(result.accepted).toBe(true);
  });
});
