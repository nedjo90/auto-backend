export interface CreateUserData {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
}

export interface IIdentityProviderAdapter {
  createUser(userData: CreateUserData): Promise<string>;
  disableUser(externalId: string): Promise<void>;
  updateUser(
    externalId: string,
    userData: Record<string, unknown>,
  ): Promise<void>;
}
