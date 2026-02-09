/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-function-type */
import {
  calculateProfileCompletion,
  getCompletionBadge,
  validateSiret,
} from "../../../srv/handlers/profile-handler";

// ─── Pure function tests ────────────────────────────────────────────────────

describe("calculateProfileCompletion", () => {
  const configFields = [
    { fieldName: "firstName", contributesToCompletion: true, weight: 2, tipKey: null },
    { fieldName: "lastName", contributesToCompletion: true, weight: 2, tipKey: null },
    { fieldName: "phone", contributesToCompletion: true, weight: 2, tipKey: "profile.tip.phone" },
    { fieldName: "siret", contributesToCompletion: true, weight: 3, tipKey: "profile.tip.siret" },
    { fieldName: "bio", contributesToCompletion: true, weight: 2, tipKey: "profile.tip.bio" },
    { fieldName: "avatarUrl", contributesToCompletion: false, weight: 1, tipKey: null },
  ];

  it("should return 100% when all contributing fields are filled", () => {
    const user = {
      firstName: "John",
      lastName: "Doe",
      phone: "+33612345678",
      siret: "12345678901234",
      bio: "A great seller",
    };
    const result = calculateProfileCompletion(user, configFields);
    expect(result.percentage).toBe(100);
    expect(result.badge).toBe("complete");
    expect(result.incompleteFields).toHaveLength(0);
  });

  it("should return 0% when no contributing fields are filled", () => {
    const user = {};
    const result = calculateProfileCompletion(user, configFields);
    expect(result.percentage).toBe(0);
    expect(result.badge).toBe("new_seller");
    expect(result.incompleteFields).toHaveLength(5);
  });

  it("should calculate weighted percentage correctly", () => {
    // firstName(2) + lastName(2) = 4 out of 2+2+2+3+2 = 11
    const user = { firstName: "John", lastName: "Doe" };
    const result = calculateProfileCompletion(user, configFields);
    expect(result.percentage).toBe(Math.round((4 / 11) * 100)); // 36
    expect(result.badge).toBe("new_seller");
    expect(result.incompleteFields).toHaveLength(3);
  });

  it("should ignore non-contributing fields", () => {
    // avatarUrl has contributesToCompletion: false
    const user = {
      firstName: "John",
      lastName: "Doe",
      phone: "+33612345678",
      siret: "12345678901234",
      bio: "Bio",
      avatarUrl: "https://example.com/avatar.jpg",
    };
    const result = calculateProfileCompletion(user, configFields);
    expect(result.percentage).toBe(100);
  });

  it("should treat null values as incomplete", () => {
    const user = { firstName: "John", lastName: "Doe", phone: null };
    const result = calculateProfileCompletion(user, configFields);
    expect(result.incompleteFields.some((f) => f.fieldName === "phone")).toBe(true);
  });

  it("should treat empty string values as incomplete", () => {
    const user = { firstName: "John", lastName: "Doe", phone: "" };
    const result = calculateProfileCompletion(user, configFields);
    expect(result.incompleteFields.some((f) => f.fieldName === "phone")).toBe(true);
  });

  it("should return tip keys for incomplete fields", () => {
    const user = { firstName: "John", lastName: "Doe" };
    const result = calculateProfileCompletion(user, configFields);
    const phoneTip = result.incompleteFields.find((f) => f.fieldName === "phone");
    expect(phoneTip?.tipKey).toBe("profile.tip.phone");
  });

  it("should handle empty config fields", () => {
    const result = calculateProfileCompletion({}, []);
    expect(result.percentage).toBe(100);
    expect(result.badge).toBe("complete");
    expect(result.incompleteFields).toHaveLength(0);
  });
});

describe("getCompletionBadge", () => {
  it("should return 'complete' for >= 90%", () => {
    expect(getCompletionBadge(90)).toBe("complete");
    expect(getCompletionBadge(100)).toBe("complete");
  });

  it("should return 'advanced' for >= 70% and < 90%", () => {
    expect(getCompletionBadge(70)).toBe("advanced");
    expect(getCompletionBadge(89)).toBe("advanced");
  });

  it("should return 'intermediate' for >= 40% and < 70%", () => {
    expect(getCompletionBadge(40)).toBe("intermediate");
    expect(getCompletionBadge(69)).toBe("intermediate");
  });

  it("should return 'new_seller' for < 40%", () => {
    expect(getCompletionBadge(0)).toBe("new_seller");
    expect(getCompletionBadge(39)).toBe("new_seller");
  });
});

describe("validateSiret", () => {
  it("should accept valid SIRET with valid SIREN Luhn", () => {
    // 443061841 is a valid SIREN (passes Luhn)
    expect(validateSiret("44306184100015")).toBe(true);
  });

  it("should reject non-14-digit strings", () => {
    expect(validateSiret("1234")).toBe(false);
    expect(validateSiret("123456789012345")).toBe(false);
    expect(validateSiret("abcdefghijklmn")).toBe(false);
  });

  it("should reject SIRET with invalid SIREN Luhn", () => {
    // 12345678 is invalid SIREN
    expect(validateSiret("12345678901234")).toBe(false);
  });

  it("should reject empty string", () => {
    expect(validateSiret("")).toBe(false);
  });
});

// ─── ProfileService handler (mocked CDS) ─────────────────────────────────

jest.mock("../../../srv/adapters/factory/adapter-factory", () => ({
  getIdentityProvider: jest.fn(() => ({
    createUser: jest.fn(),
    disableUser: jest.fn(),
    updateUser: jest.fn(),
  })),
}));

jest.mock("@sap/cds", () => {
  class MockApplicationService {
    on = jest.fn();
    async init() {}
  }
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return {
    __esModule: true,
    default: {
      ApplicationService: MockApplicationService,
      entities: jest.fn(() => ({
        User: "User",
        SellerRating: "SellerRating",
        ConfigProfileField: "ConfigProfileField",
      })),
      run: jest.fn(),
      log: jest.fn(() => mockLog),
      utils: { uuid: jest.fn(() => "test-uuid-456") },
    },
  };
});

const cds = require("@sap/cds").default;
const mockRun = cds.run as jest.Mock;

// Mock CDS query builders
(global as any).SELECT = {
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue({
      orderBy: jest.fn().mockReturnValue("select-query"),
    }),
    columns: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue("select-columns-query"),
    }),
    orderBy: jest.fn().mockReturnValue("select-ordered-query"),
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

(global as any).UPDATE = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("update-query"),
  }),
});

const ProfileService = require("../../../srv/handlers/profile-handler").default;

describe("ProfileService handler", () => {
  let service: any;
  let registeredHandlers: Record<string, Function>;
  const mockAdapter = {
    createUser: jest.fn(),
    disableUser: jest.fn(),
    updateUser: jest.fn(),
  };

  beforeEach(async () => {
    mockRun.mockReset();
    mockAdapter.createUser.mockReset();
    mockAdapter.disableUser.mockReset();
    mockAdapter.updateUser.mockReset();

    registeredHandlers = {};
    service = new ProfileService();
    service.on = jest.fn((event: string, entityOrHandler: any, handler?: any) => {
      const key = handler ? `${event}:${entityOrHandler}` : event;
      registeredHandlers[key] = handler || entityOrHandler;
    });
    await service.init();
    // Override identityProvider AFTER init (init sets it from factory)
    service.identityProvider = mockAdapter;
  });

  it("should register all handlers on init", () => {
    expect(service.on).toHaveBeenCalledWith("READ", "UserProfiles", expect.any(Function));
    expect(service.on).toHaveBeenCalledWith("READ", "PublicSellerProfiles", expect.any(Function));
    expect(service.on).toHaveBeenCalledWith("READ", "ConfigProfileFields", expect.any(Function));
    expect(service.on).toHaveBeenCalledWith("updateProfile", expect.any(Function));
    expect(service.on).toHaveBeenCalledWith("getProfileCompletion", expect.any(Function));
    expect(service.on).toHaveBeenCalledWith("getPublicSellerProfile", expect.any(Function));
  });

  describe("updateProfile", () => {
    const mockReq = (input: Record<string, unknown>, userId = "azure-user-id") => ({
      data: { input },
      user: { id: userId },
      reject: jest.fn((code: number, msg: string) => {
        const err: any = new Error(msg);
        err.code = code;
        throw err;
      }),
    });

    it("should update profile successfully", async () => {
      mockRun
        .mockResolvedValueOnce({
          ID: "user-1",
          azureAdB2cId: "azure-user-id",
          firstName: "John",
          status: "active",
          isAnonymized: false,
        }) // find user
        .mockResolvedValueOnce(undefined) // UPDATE user
        .mockResolvedValueOnce({ ID: "user-1", firstName: "John", phone: "+33612345678" }) // re-fetch user
        .mockResolvedValueOnce([
          { fieldName: "firstName", contributesToCompletion: true, weight: 2, tipKey: null },
          {
            fieldName: "phone",
            contributesToCompletion: true,
            weight: 2,
            tipKey: "profile.tip.phone",
          },
        ]) // config fields
        .mockResolvedValueOnce(null) // existing rating (none)
        .mockResolvedValueOnce(undefined); // INSERT rating

      const req = mockReq({ phone: "+33612345678" });
      const handler = registeredHandlers["updateProfile"];
      const result = await handler(req);

      expect(result).toEqual({ success: true, userId: "user-1" });
    });

    it("should reject unauthenticated request", async () => {
      const req = {
        data: { input: { phone: "+33612345678" } },
        user: {},
        reject: jest.fn((code: number, msg: string) => {
          throw new Error(msg);
        }),
      };

      const handler = registeredHandlers["updateProfile"];
      await expect(handler(req)).rejects.toThrow("Authentication required");
    });

    it("should reject invalid SIRET", async () => {
      const req = mockReq({ siret: "12345678901234" }); // fails Luhn via Zod schema

      const handler = registeredHandlers["updateProfile"];
      await expect(handler(req)).rejects.toThrow();
    });

    it("should reject when user not found", async () => {
      mockRun.mockResolvedValueOnce(null);

      const req = mockReq({ phone: "+33612345678" });
      const handler = registeredHandlers["updateProfile"];
      await expect(handler(req)).rejects.toThrow("User not found");
    });

    it("should reject when user is suspended", async () => {
      mockRun.mockResolvedValueOnce({
        ID: "user-1",
        azureAdB2cId: "azure-user-id",
        status: "suspended",
        isAnonymized: false,
      });

      const req = mockReq({ phone: "+33612345678" });
      const handler = registeredHandlers["updateProfile"];
      await expect(handler(req)).rejects.toThrow("Account is not active");
    });

    it("should reject when user is anonymized", async () => {
      mockRun.mockResolvedValueOnce({
        ID: "user-1",
        azureAdB2cId: "azure-user-id",
        status: "active",
        isAnonymized: true,
      });

      const req = mockReq({ phone: "+33612345678" });
      const handler = registeredHandlers["updateProfile"];
      await expect(handler(req)).rejects.toThrow("Account is anonymized");
    });

    it("should convert empty string values to null", async () => {
      mockRun
        .mockResolvedValueOnce({
          ID: "user-1",
          azureAdB2cId: "azure-user-id",
          status: "active",
          isAnonymized: false,
        })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ ID: "user-1" })
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(undefined);

      const req = mockReq({ phone: "" });
      const handler = registeredHandlers["updateProfile"];
      await handler(req);

      // The UPDATE call is the 2nd cds.run call
      expect(mockRun).toHaveBeenCalledTimes(6);
    });

    it("should update existing SellerRating instead of inserting", async () => {
      mockRun
        .mockResolvedValueOnce({
          ID: "user-1",
          azureAdB2cId: "azure-user-id",
          firstName: "John",
          status: "active",
          isAnonymized: false,
        })
        .mockResolvedValueOnce(undefined) // UPDATE user
        .mockResolvedValueOnce({ ID: "user-1", firstName: "John", phone: "+33612345678" })
        .mockResolvedValueOnce([
          { fieldName: "firstName", contributesToCompletion: true, weight: 2, tipKey: null },
        ])
        .mockResolvedValueOnce({ ID: "rating-1", user_ID: "user-1" }) // existing rating
        .mockResolvedValueOnce(undefined); // UPDATE rating

      const req = mockReq({ phone: "+33612345678" });
      const handler = registeredHandlers["updateProfile"];
      const result = await handler(req);

      expect(result).toEqual({ success: true, userId: "user-1" });
    });

    it("should sync display name to AD B2C", async () => {
      mockRun
        .mockResolvedValueOnce({
          ID: "user-1",
          azureAdB2cId: "azure-user-id",
          status: "active",
          isAnonymized: false,
        })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ ID: "user-1", displayName: "New Name" })
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(undefined);

      const req = mockReq({ displayName: "New Name" });
      const handler = registeredHandlers["updateProfile"];
      await handler(req);

      expect(mockAdapter.updateUser).toHaveBeenCalledWith("azure-user-id", {
        displayName: "New Name",
      });
    });

    it("should not block profile save if AD B2C sync fails", async () => {
      mockRun
        .mockResolvedValueOnce({
          ID: "user-1",
          azureAdB2cId: "azure-user-id",
          status: "active",
          isAnonymized: false,
        })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ ID: "user-1", displayName: "New Name" })
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(undefined);

      mockAdapter.updateUser.mockRejectedValueOnce(new Error("Graph API error"));

      const req = mockReq({ displayName: "New Name" });
      const handler = registeredHandlers["updateProfile"];
      const result = await handler(req);

      expect(result).toEqual({ success: true, userId: "user-1" });
    });

    it("should return success without DB update when no fields provided", async () => {
      mockRun.mockResolvedValueOnce({
        ID: "user-1",
        azureAdB2cId: "azure-user-id",
        status: "active",
        isAnonymized: false,
      });

      const req = mockReq({});
      const handler = registeredHandlers["updateProfile"];
      const result = await handler(req);

      expect(result).toEqual({ success: true, userId: "user-1" });
    });
  });

  describe("getUserProfile (READ:UserProfiles)", () => {
    it("should return user data for authenticated user", async () => {
      mockRun.mockResolvedValueOnce([{ ID: "user-1", email: "test@test.com" }]);

      const req = {
        user: { id: "azure-user-id" },
        reject: jest.fn((code: number, msg: string) => {
          throw new Error(msg);
        }),
      };
      const handler = registeredHandlers["READ:UserProfiles"];
      const result = await handler(req);

      expect(result).toEqual([{ ID: "user-1", email: "test@test.com" }]);
    });

    it("should reject unauthenticated request", async () => {
      const req = {
        user: {},
        reject: jest.fn((code: number, msg: string) => {
          throw new Error(msg);
        }),
      };
      const handler = registeredHandlers["READ:UserProfiles"];
      await expect(handler(req)).rejects.toThrow("Authentication required");
    });
  });

  describe("getPublicSellerProfiles (READ:PublicSellerProfiles)", () => {
    it("should return only active non-anonymized users", async () => {
      mockRun.mockResolvedValueOnce([
        { ID: "seller-1", displayName: "Marie D.", status: "active", isAnonymized: false },
      ]);

      const handler = registeredHandlers["READ:PublicSellerProfiles"];
      const result = await handler({});

      expect(result).toHaveLength(1);
    });
  });

  describe("getConfigProfileFields (READ:ConfigProfileFields)", () => {
    it("should return config fields ordered by displayOrder", async () => {
      mockRun.mockResolvedValueOnce([
        { ID: "1", fieldName: "firstName", displayOrder: 1 },
        { ID: "2", fieldName: "phone", displayOrder: 2 },
      ]);

      const handler = registeredHandlers["READ:ConfigProfileFields"];
      const result = await handler({});

      expect(result).toHaveLength(2);
    });
  });

  describe("getProfileCompletion", () => {
    it("should return completion data for authenticated user", async () => {
      mockRun
        .mockResolvedValueOnce({ ID: "user-1", firstName: "John", phone: "+33612345678" }) // find user
        .mockResolvedValueOnce([
          { fieldName: "firstName", contributesToCompletion: true, weight: 2, tipKey: null },
          {
            fieldName: "phone",
            contributesToCompletion: true,
            weight: 2,
            tipKey: "profile.tip.phone",
          },
        ]); // config fields

      const req = {
        data: {},
        user: { id: "azure-user-id" },
        reject: jest.fn(),
      };
      const handler = registeredHandlers["getProfileCompletion"];
      const result = await handler(req);

      expect(result.percentage).toBe(100);
      expect(result.badge).toBe("complete");
    });
  });

  describe("getPublicSellerProfile", () => {
    it("should return public seller profile", async () => {
      mockRun
        .mockResolvedValueOnce({
          ID: "seller-1",
          firstName: "Marie",
          lastName: "Dupont",
          displayName: "Marie D.",
          avatarUrl: null,
          bio: "Vendeuse pro",
          isAnonymized: false,
          status: "active",
          accountCreatedAt: "2024-01-15T00:00:00Z",
          createdAt: "2024-01-15T00:00:00Z",
        }) // seller
        .mockResolvedValueOnce({
          overallRating: 4.2,
          totalListings: 5,
        }) // rating
        .mockResolvedValueOnce([
          { fieldName: "firstName", contributesToCompletion: true, weight: 2, tipKey: null },
          { fieldName: "bio", contributesToCompletion: true, weight: 2, tipKey: null },
        ]); // config

      const req = {
        data: { sellerId: "seller-1" },
        user: { id: "any-user" },
        reject: jest.fn(),
      };
      const handler = registeredHandlers["getPublicSellerProfile"];
      const result = await handler(req);

      expect(result.displayName).toBe("Marie D.");
      expect(result.rating).toBe(4.2);
      expect(result.totalListings).toBe(5);
      expect(result.isAnonymized).toBe(false);
    });

    it("should return anonymized profile for anonymized seller", async () => {
      mockRun.mockResolvedValueOnce({
        ID: "seller-2",
        isAnonymized: true,
        accountCreatedAt: "2024-01-15T00:00:00Z",
        createdAt: "2024-01-15T00:00:00Z",
      });

      const req = {
        data: { sellerId: "seller-2" },
        user: { id: "any-user" },
        reject: jest.fn(),
      };
      const handler = registeredHandlers["getPublicSellerProfile"];
      const result = await handler(req);

      expect(result.displayName).toBe("Utilisateur anonymisé");
      expect(result.isAnonymized).toBe(true);
      expect(result.rating).toBe(0);
    });

    it("should reject when sellerId is missing", async () => {
      const req = {
        data: {},
        user: { id: "any-user" },
        reject: jest.fn((code: number, msg: string) => {
          throw new Error(msg);
        }),
      };
      const handler = registeredHandlers["getPublicSellerProfile"];
      await expect(handler(req)).rejects.toThrow("sellerId is required");
    });

    it("should reject when seller not found", async () => {
      mockRun.mockResolvedValueOnce(null);

      const req = {
        data: { sellerId: "unknown" },
        user: { id: "any-user" },
        reject: jest.fn((code: number, msg: string) => {
          throw new Error(msg);
        }),
      };
      const handler = registeredHandlers["getPublicSellerProfile"];
      await expect(handler(req)).rejects.toThrow("Seller not found");
    });

    it("should reject suspended seller", async () => {
      mockRun.mockResolvedValueOnce({
        ID: "seller-4",
        status: "suspended",
        isAnonymized: false,
      });

      const req = {
        data: { sellerId: "seller-4" },
        user: { id: "any-user" },
        reject: jest.fn((code: number, msg: string) => {
          throw new Error(msg);
        }),
      };
      const handler = registeredHandlers["getPublicSellerProfile"];
      await expect(handler(req)).rejects.toThrow("Seller not found");
    });

    it("should use computed display name when displayName is empty", async () => {
      mockRun
        .mockResolvedValueOnce({
          ID: "seller-3",
          firstName: "Jean",
          lastName: "Martin",
          displayName: null,
          isAnonymized: false,
          status: "active",
          accountCreatedAt: "2024-06-01T00:00:00Z",
          createdAt: "2024-06-01T00:00:00Z",
        })
        .mockResolvedValueOnce(null) // no rating
        .mockResolvedValueOnce([]); // no config fields

      const req = {
        data: { sellerId: "seller-3" },
        user: { id: "any-user" },
        reject: jest.fn(),
      };
      const handler = registeredHandlers["getPublicSellerProfile"];
      const result = await handler(req);

      expect(result.displayName).toBe("Jean Martin");
    });

    it("should fallback to 'Utilisateur' when displayName and names are null", async () => {
      mockRun
        .mockResolvedValueOnce({
          ID: "seller-5",
          firstName: null,
          lastName: null,
          displayName: null,
          isAnonymized: false,
          status: "active",
          accountCreatedAt: "2024-06-01T00:00:00Z",
          createdAt: "2024-06-01T00:00:00Z",
        })
        .mockResolvedValueOnce(null) // no rating
        .mockResolvedValueOnce([]); // no config fields

      const req = {
        data: { sellerId: "seller-5" },
        user: { id: "any-user" },
        reject: jest.fn(),
      };
      const handler = registeredHandlers["getPublicSellerProfile"];
      const result = await handler(req);

      expect(result.displayName).toBe("Utilisateur");
    });
  });
});
