import { Test, TestingModule } from '@nestjs/testing';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';

describe('ProfilesController', () => {
  let controller: ProfilesController;

  const mockService = {
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
    getTemplates: jest.fn(),
    createTemplate: jest.fn(),
    updateTemplate: jest.fn(),
    deleteTemplate: jest.fn(),
  };

  const req = { user: { id: 'user-1' } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProfilesController],
      providers: [{ provide: ProfilesService, useValue: mockService }],
    }).compile();
    controller = module.get<ProfilesController>(ProfilesController);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(controller).toBeDefined());

  it('getProfile delega para service', async () => {
    mockService.getProfile.mockResolvedValueOnce({});
    await controller.getProfile(req as any);
    expect(mockService.getProfile).toHaveBeenCalledWith('user-1');
  });

  it('updateProfile delega para service', async () => {
    const dto = { pix_key: '123' };
    mockService.updateProfile.mockResolvedValueOnce({});
    await controller.updateProfile(req as any, dto);
    expect(mockService.updateProfile).toHaveBeenCalledWith('user-1', dto);
  });

  it('getTemplates delega para service', async () => {
    mockService.getTemplates.mockResolvedValueOnce([]);
    await controller.getTemplates(req as any);
    expect(mockService.getTemplates).toHaveBeenCalledWith('user-1');
  });

  it('createTemplate delega para service', async () => {
    const dto = { name: 'X', body: 'Y' };
    mockService.createTemplate.mockResolvedValueOnce({});
    await controller.createTemplate(req as any, dto);
    expect(mockService.createTemplate).toHaveBeenCalledWith('user-1', dto);
  });

  it('updateTemplate delega para service', async () => {
    const dto = { body: 'Z' };
    mockService.updateTemplate.mockResolvedValueOnce({});
    await controller.updateTemplate(req as any, 't1', dto);
    expect(mockService.updateTemplate).toHaveBeenCalledWith('user-1', 't1', dto);
  });

  it('deleteTemplate delega para service', async () => {
    mockService.deleteTemplate.mockResolvedValueOnce({ success: true });
    await controller.deleteTemplate(req as any, 't1');
    expect(mockService.deleteTemplate).toHaveBeenCalledWith('user-1', 't1');
  });
});
