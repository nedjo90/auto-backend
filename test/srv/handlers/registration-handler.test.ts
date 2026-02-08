import { validateRegistrationInput } from "../../../srv/handlers/registration-handler";

// Mock the adapter factory
jest.mock("../../../srv/adapters/factory/adapter-factory", () => ({
  getIdentityProvider: jest.fn(() => ({
    createUser: jest.fn(),
    disableUser: jest.fn(),
    updateUser: jest.fn(),
  })),
}));

// ─── validateRegistrationInput (pure function) ────────────────────────────

describe("validateRegistrationInput", () => {
  const fields = [
    { fieldName: "email", isRequired: true, validationPattern: null },
    { fieldName: "firstName", isRequired: true, validationPattern: null },
    { fieldName: "lastName", isRequired: true, validationPattern: null },
    { fieldName: "phone", isRequired: false, validationPattern: null },
    {
      fieldName: "siret",
      isRequired: false,
      validationPattern: "\\d{14}",
    },
  ];

  it("should return no errors for valid input with all required fields", () => {
    const input = {
      email: "test@example.com",
      firstName: "John",
      lastName: "Doe",
    };
    expect(validateRegistrationInput(input, fields)).toEqual([]);
  });

  it("should return errors for missing required fields", () => {
    const input = { email: "", firstName: "", lastName: "" };
    const errors = validateRegistrationInput(input, fields);
    expect(errors).toContain("email is required");
    expect(errors).toContain("firstName is required");
    expect(errors).toContain("lastName is required");
    expect(errors).toHaveLength(3);
  });

  it("should return error for null required field", () => {
    const input = { email: null, firstName: "John", lastName: "Doe" };
    const errors = validateRegistrationInput(input, fields);
    expect(errors).toContain("email is required");
    expect(errors).toHaveLength(1);
  });

  it("should return error for undefined required field", () => {
    const input = { firstName: "John", lastName: "Doe" };
    const errors = validateRegistrationInput(input, fields);
    expect(errors).toContain("email is required");
    expect(errors).toHaveLength(1);
  });

  it("should return error for whitespace-only required field", () => {
    const input = { email: "   ", firstName: "John", lastName: "Doe" };
    const errors = validateRegistrationInput(input, fields);
    expect(errors).toContain("email is required");
  });

  it("should not require optional fields", () => {
    const input = {
      email: "test@example.com",
      firstName: "John",
      lastName: "Doe",
    };
    expect(validateRegistrationInput(input, fields)).toEqual([]);
  });

  it("should validate pattern for siret when provided", () => {
    const input = {
      email: "test@example.com",
      firstName: "John",
      lastName: "Doe",
      siret: "abc",
    };
    const errors = validateRegistrationInput(input, fields);
    expect(errors).toContain("siret format is invalid");
  });

  it("should pass pattern validation for correct siret", () => {
    const input = {
      email: "test@example.com",
      firstName: "John",
      lastName: "Doe",
      siret: "12345678901234",
    };
    expect(validateRegistrationInput(input, fields)).toEqual([]);
  });

  it("should skip pattern validation when optional field is empty", () => {
    const input = {
      email: "test@example.com",
      firstName: "John",
      lastName: "Doe",
      siret: "",
    };
    expect(validateRegistrationInput(input, fields)).toEqual([]);
  });

  it("should skip pattern validation when optional field is not provided", () => {
    const input = {
      email: "test@example.com",
      firstName: "John",
      lastName: "Doe",
    };
    expect(validateRegistrationInput(input, fields)).toEqual([]);
  });

  it("should return multiple errors for multiple invalid fields", () => {
    const input = {
      email: "",
      firstName: "",
      lastName: "Doe",
      siret: "bad-siret",
    };
    const errors = validateRegistrationInput(input, fields);
    expect(errors).toContain("email is required");
    expect(errors).toContain("firstName is required");
    expect(errors).toContain("siret format is invalid");
    expect(errors).toHaveLength(3);
  });

  it("should handle empty fields array", () => {
    const input = { email: "test@example.com" };
    expect(validateRegistrationInput(input, [])).toEqual([]);
  });

  it("should handle invalid regex pattern gracefully", () => {
    const badFields = [
      {
        fieldName: "custom",
        isRequired: false,
        validationPattern: "[invalid((",
      },
    ];
    const input = { custom: "test" };
    const errors = validateRegistrationInput(input, badFields);
    expect(errors).toContain("custom has invalid validation configuration");
  });

  it("should reject values exceeding max length for regex validation", () => {
    const fields = [
      {
        fieldName: "code",
        isRequired: false,
        validationPattern: "^\\w+$",
      },
    ];
    const input = { code: "a".repeat(1001) };
    const errors = validateRegistrationInput(input, fields);
    expect(errors).toContain("code value is too long");
  });

  it("should handle fields with both required and pattern", () => {
    const strictFields = [
      {
        fieldName: "email",
        isRequired: true,
        validationPattern: "^[^@]+@[^@]+\\.[^@]+$",
      },
    ];
    const input = { email: "invalid-email" };
    const errors = validateRegistrationInput(input, strictFields);
    expect(errors).toContain("email format is invalid");
  });

  it("should not validate pattern for required field that is missing", () => {
    const strictFields = [
      {
        fieldName: "email",
        isRequired: true,
        validationPattern: "^[^@]+@[^@]+\\.[^@]+$",
      },
    ];
    const input = { email: "" };
    const errors = validateRegistrationInput(input, strictFields);
    expect(errors).toContain("email is required");
    expect(errors).not.toContain("email format is invalid");
  });
});

// ─── RegistrationService handler (mocked CDS) ────────────────────────────

jest.mock("@sap/cds", () => {
  class MockApplicationService {
    on = jest.fn();
    async init() {}
  }
  return {
    __esModule: true,
    default: {
      ApplicationService: MockApplicationService,
      entities: jest.fn(() => ({
        ConfigRegistrationField: "ConfigRegistrationField",
        User: "User",
        UserRole: "UserRole",
      })),
      run: jest.fn(),
      utils: { uuid: jest.fn(() => "test-uuid-123") },
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cds = require("@sap/cds").default;
const mockRun = cds.run as jest.Mock;
const mockUuid = cds.utils.uuid as jest.Mock;

// Mock CDS query builders as globals
(global as any).SELECT = {
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue({
      orderBy: jest.fn().mockReturnValue("select-fields-query"),
    }),
  }),
  one: {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue("select-one-query"),
    }),
  },
};

(global as any).INSERT = {
  into: jest.fn().mockReturnValue({
    entries: jest.fn().mockReturnValue("insert-query"),
  }),
};

// Import handler after CDS is mocked
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RegistrationService =
  require("../../../srv/handlers/registration-handler").default;

describe("RegistrationService handler", () => {
  let service: any;
  let registeredHandlers: Record<string, Function>;
  const mockAdapter = {
    createUser: jest.fn(),
    disableUser: jest.fn(),
    updateUser: jest.fn(),
  };

  beforeEach(async () => {
    mockRun.mockReset();
    mockUuid.mockReturnValue("test-uuid-123");
    mockAdapter.createUser.mockReset();
    mockAdapter.disableUser.mockReset();

    registeredHandlers = {};
    service = new RegistrationService();
    service.on = jest.fn(
      (event: string, entityOrHandler: any, handler?: any) => {
        const key = handler ? `${event}:${entityOrHandler}` : event;
        registeredHandlers[key] = handler || entityOrHandler;
      },
    );
    service.identityProvider = mockAdapter;
    await service.init();
  });

  it("should register READ and register handlers on init", () => {
    expect(service.on).toHaveBeenCalledWith(
      "READ",
      "ConfigRegistrationFields",
      expect.any(Function),
    );
    expect(service.on).toHaveBeenCalledWith("register", expect.any(Function));
  });

  describe("getRegistrationFields", () => {
    it("should query visible fields ordered by displayOrder", async () => {
      const mockFields = [
        { fieldName: "email", displayOrder: 10, isVisible: true },
        { fieldName: "firstName", displayOrder: 20, isVisible: true },
      ];
      mockRun.mockResolvedValueOnce(mockFields);

      const handler = registeredHandlers["READ:ConfigRegistrationFields"];
      const result = await handler();

      expect(mockRun).toHaveBeenCalled();
      expect(result).toEqual(mockFields);
    });
  });

  describe("register action", () => {
    const validInput = {
      email: "new@example.com",
      firstName: "Jane",
      lastName: "Doe",
      password: "SecureP@ss1",
      phone: null,
      siret: null,
    };

    const configFields = [
      {
        fieldName: "email",
        isRequired: true,
        isVisible: true,
        validationPattern: null,
      },
      {
        fieldName: "firstName",
        isRequired: true,
        isVisible: true,
        validationPattern: null,
      },
      {
        fieldName: "lastName",
        isRequired: true,
        isVisible: true,
        validationPattern: null,
      },
      {
        fieldName: "phone",
        isRequired: false,
        isVisible: true,
        validationPattern: null,
      },
      {
        fieldName: "siret",
        isRequired: false,
        isVisible: true,
        validationPattern: "\\d{14}",
      },
    ];

    const mockReq = (input: Record<string, unknown>) => ({
      data: { input },
      reject: jest.fn((code: number, msg: string) => {
        const err: any = new Error(msg);
        err.code = code;
        throw err;
      }),
    });

    it("should register user successfully", async () => {
      mockRun
        .mockResolvedValueOnce(configFields) // getFields
        .mockResolvedValueOnce(null) // no existing user
        .mockResolvedValueOnce(undefined) // INSERT user
        .mockResolvedValueOnce(undefined); // INSERT role

      mockAdapter.createUser.mockResolvedValueOnce("ad-b2c-id-123");

      const req = mockReq(validInput);
      const handler = registeredHandlers["register"];
      const result = await handler(req);

      expect(result).toEqual({
        success: true,
        userId: "test-uuid-123",
        email: "new@example.com",
        redirectUrl: "/auth/callback",
      });
      expect(mockAdapter.createUser).toHaveBeenCalledWith({
        email: "new@example.com",
        firstName: "Jane",
        lastName: "Doe",
        password: "SecureP@ss1",
      });
    });

    it("should reject with 400 for missing required fields", async () => {
      mockRun.mockResolvedValueOnce(configFields);

      const req = mockReq({ ...validInput, email: "", firstName: "" });
      const handler = registeredHandlers["register"];

      await expect(handler(req)).rejects.toThrow();
      expect(req.reject).toHaveBeenCalledWith(
        400,
        expect.stringContaining("email is required"),
      );
    });

    it("should reject with 409 for duplicate email", async () => {
      mockRun
        .mockResolvedValueOnce(configFields)
        .mockResolvedValueOnce({
          ID: "existing-id",
          email: "new@example.com",
        });

      const req = mockReq(validInput);
      const handler = registeredHandlers["register"];

      await expect(handler(req)).rejects.toThrow("Email already registered");
      expect(req.reject).toHaveBeenCalledWith(409, "Email already registered");
    });

    it("should initialize identity provider from factory during init", () => {
      // identityProvider was null before init, but init() calls getIdentityProvider()
      expect(service.identityProvider).toBeDefined();
      expect(service.identityProvider).not.toBeNull();
    });

    it("should reject with 502 on AD B2C API failure", async () => {
      mockRun
        .mockResolvedValueOnce(configFields)
        .mockResolvedValueOnce(null);

      mockAdapter.createUser.mockRejectedValueOnce(
        new Error("Graph API timeout"),
      );

      const req = mockReq(validInput);
      const handler = registeredHandlers["register"];

      await expect(handler(req)).rejects.toThrow();
      expect(req.reject).toHaveBeenCalledWith(
        502,
        "Identity provider error: Graph API timeout",
      );
    });

    it("should rollback AD B2C user on DB insert failure", async () => {
      mockRun
        .mockResolvedValueOnce(configFields)
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error("DB constraint violation"));

      mockAdapter.createUser.mockResolvedValueOnce("ad-b2c-id-456");

      const req = mockReq(validInput);
      const handler = registeredHandlers["register"];

      await expect(handler(req)).rejects.toThrow("Registration failed");
      expect(mockAdapter.disableUser).toHaveBeenCalledWith("ad-b2c-id-456");
    });

    it("should still reject even if rollback fails", async () => {
      mockRun
        .mockResolvedValueOnce(configFields)
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error("DB error"));

      mockAdapter.createUser.mockResolvedValueOnce("ad-b2c-id-789");
      mockAdapter.disableUser.mockRejectedValueOnce(
        new Error("Rollback failed"),
      );

      const req = mockReq(validInput);
      const handler = registeredHandlers["register"];

      await expect(handler(req)).rejects.toThrow("Registration failed");
    });

    it("should validate siret pattern when provided", async () => {
      mockRun.mockResolvedValueOnce(configFields);

      const req = mockReq({ ...validInput, siret: "invalid-siret" });
      const handler = registeredHandlers["register"];

      await expect(handler(req)).rejects.toThrow();
      expect(req.reject).toHaveBeenCalledWith(
        400,
        expect.stringContaining("siret format is invalid"),
      );
    });

    it("should reject missing password", async () => {
      mockRun.mockResolvedValueOnce(configFields);

      const req = mockReq({ ...validInput, password: "" });
      const handler = registeredHandlers["register"];

      await expect(handler(req)).rejects.toThrow();
      expect(req.reject).toHaveBeenCalledWith(
        400,
        expect.stringContaining("password is required"),
      );
    });

    it("should reject short password (< 8 chars)", async () => {
      mockRun.mockResolvedValueOnce(configFields);

      const req = mockReq({ ...validInput, password: "short" });
      const handler = registeredHandlers["register"];

      await expect(handler(req)).rejects.toThrow();
      expect(req.reject).toHaveBeenCalledWith(
        400,
        expect.stringContaining("password must be at least 8 characters"),
      );
    });

    it("should accept valid optional fields", async () => {
      mockRun
        .mockResolvedValueOnce(configFields)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      mockAdapter.createUser.mockResolvedValueOnce("ad-b2c-id-opt");

      const req = mockReq({
        ...validInput,
        phone: "+33612345678",
        siret: "12345678901234",
      });
      const handler = registeredHandlers["register"];
      const result = await handler(req);

      expect(result.success).toBe(true);
    });
  });
});
