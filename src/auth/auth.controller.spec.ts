import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;

  const mockAuthService = {
    login: jest.fn(),
    register: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call authService.login on login', async () => {
    mockAuthService.login.mockResolvedValueOnce({ token: 'abc' });
    const result = await controller.login({ email: 'e', password: 'p' });
    expect(authService.login).toHaveBeenCalled();
    expect(result.token).toBe('abc');
  });

  it('should call authService.register on register', async () => {
    mockAuthService.register.mockResolvedValueOnce({ token: 'xyz' });
    const result = await controller.register({ name: 'N', email: 'E', phone: 'P', password: 'P' });
    expect(authService.register).toHaveBeenCalled();
    expect(result.token).toBe('xyz');
  });
});
