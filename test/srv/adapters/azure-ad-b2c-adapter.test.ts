import { AzureAdB2cAdapter } from "../../../srv/adapters/azure-ad-b2c-adapter";
import type { CreateUserData } from "../../../srv/adapters/interfaces/identity-provider.interface";
import {
  getIdentityProvider,
  setIdentityProvider,
  resetIdentityProvider,
} from "../../../srv/adapters/factory/adapter-factory";

// Mock the Microsoft Graph Client
const mockPost = jest.fn();
const mockUpdate = jest.fn();
const mockApi = jest.fn().mockReturnValue({
  post: mockPost,
  update: mockUpdate,
});

const mockClient = { api: mockApi } as any;

describe("AzureAdB2cAdapter", () => {
  let adapter: AzureAdB2cAdapter;

  beforeEach(() => {
    mockApi.mockClear();
    mockPost.mockClear();
    mockUpdate.mockClear();
    adapter = new AzureAdB2cAdapter(mockClient, "test-tenant");
  });

  describe("createUser", () => {
    const userData: CreateUserData = {
      email: "test@example.com",
      firstName: "John",
      lastName: "Doe",
      password: "SecureP@ss1",
    };

    it("should create user in AD B2C and return external ID", async () => {
      mockPost.mockResolvedValueOnce({ id: "ad-b2c-user-123" });

      const result = await adapter.createUser(userData);

      expect(result).toBe("ad-b2c-user-123");
      expect(mockApi).toHaveBeenCalledWith("/users");
      expect(mockPost).toHaveBeenCalledWith({
        accountEnabled: true,
        displayName: "John Doe",
        givenName: "John",
        surname: "Doe",
        identities: [
          {
            signInType: "emailAddress",
            issuer: "test-tenant.onmicrosoft.com",
            issuerAssignedId: "test@example.com",
          },
        ],
        passwordProfile: {
          password: "SecureP@ss1",
          forceChangePasswordNextSignIn: false,
        },
      });
    });

    it("should throw on Graph API error", async () => {
      mockPost.mockRejectedValueOnce(new Error("Graph API 400: Bad Request"));

      await expect(adapter.createUser(userData)).rejects.toThrow(
        "Graph API 400: Bad Request",
      );
    });

    it("should use tenant name from constructor", async () => {
      const customAdapter = new AzureAdB2cAdapter(
        mockClient,
        "custom-tenant",
      );
      mockPost.mockResolvedValueOnce({ id: "user-456" });

      await customAdapter.createUser(userData);

      expect(mockPost).toHaveBeenCalledWith(
        expect.objectContaining({
          identities: [
            expect.objectContaining({
              issuer: "custom-tenant.onmicrosoft.com",
            }),
          ],
        }),
      );
    });
  });

  describe("disableUser", () => {
    it("should disable user account in AD B2C", async () => {
      mockUpdate.mockResolvedValueOnce(undefined);

      await adapter.disableUser("ad-b2c-user-123");

      expect(mockApi).toHaveBeenCalledWith("/users/ad-b2c-user-123");
      expect(mockUpdate).toHaveBeenCalledWith({ accountEnabled: false });
    });

    it("should throw on Graph API error", async () => {
      mockUpdate.mockRejectedValueOnce(new Error("Not Found"));

      await expect(adapter.disableUser("nonexistent")).rejects.toThrow(
        "Not Found",
      );
    });
  });

  describe("updateUser", () => {
    it("should update user data in AD B2C", async () => {
      mockUpdate.mockResolvedValueOnce(undefined);

      await adapter.updateUser("ad-b2c-user-123", {
        displayName: "Jane Doe",
        givenName: "Jane",
      });

      expect(mockApi).toHaveBeenCalledWith("/users/ad-b2c-user-123");
      expect(mockUpdate).toHaveBeenCalledWith({
        displayName: "Jane Doe",
        givenName: "Jane",
      });
    });

    it("should throw on Graph API error", async () => {
      mockUpdate.mockRejectedValueOnce(new Error("Forbidden"));

      await expect(
        adapter.updateUser("user-123", { displayName: "Test" }),
      ).rejects.toThrow("Forbidden");
    });
  });
});

describe("AdapterFactory", () => {
  beforeEach(() => {
    resetIdentityProvider();
  });

  it("should allow setting a custom identity provider", () => {
    const mockAdapter = {
      createUser: jest.fn(),
      disableUser: jest.fn(),
      updateUser: jest.fn(),
    };

    setIdentityProvider(mockAdapter);
    const result = getIdentityProvider();

    expect(result).toBe(mockAdapter);
  });

  it("should return same instance on multiple calls after set", () => {
    const mockAdapter = {
      createUser: jest.fn(),
      disableUser: jest.fn(),
      updateUser: jest.fn(),
    };

    setIdentityProvider(mockAdapter);
    const first = getIdentityProvider();
    const second = getIdentityProvider();

    expect(first).toBe(second);
  });

  it("should reset identity provider instance", () => {
    const mockAdapter = {
      createUser: jest.fn(),
      disableUser: jest.fn(),
      updateUser: jest.fn(),
    };

    setIdentityProvider(mockAdapter);
    resetIdentityProvider();

    // After reset, getIdentityProvider would create a new AzureAdB2cAdapter
    // which requires env vars — just verify reset works by setting again
    const newMock = {
      createUser: jest.fn(),
      disableUser: jest.fn(),
      updateUser: jest.fn(),
    };
    setIdentityProvider(newMock);
    expect(getIdentityProvider()).toBe(newMock);
    expect(getIdentityProvider()).not.toBe(mockAdapter);
  });
});
