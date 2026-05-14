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
});
