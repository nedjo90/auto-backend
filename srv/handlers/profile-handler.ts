import cds from "@sap/cds";
import { profileUpdateInputSchema, validateSirenLuhn } from "@auto/shared";
import type { IIdentityProviderAdapter } from "../adapters/interfaces/identity-provider.interface";
import { getIdentityProvider } from "../adapters/factory/adapter-factory";

export type ProfileCompletionBadge = "complete" | "advanced" | "intermediate" | "new_seller";

/**
 * Calculates weighted profile completion percentage.
 */
export function calculateProfileCompletion(
  user: Record<string, unknown>,
  configFields: Array<{
    fieldName: string;
    contributesToCompletion: boolean;
    weight: number;
    tipKey: string | null;
  }>,
): {
  percentage: number;
  badge: ProfileCompletionBadge;
  incompleteFields: Array<{ fieldName: string; tipKey: string | null }>;
} {
  const completionFields = configFields.filter((f) => f.contributesToCompletion);

  if (completionFields.length === 0) {
    return { percentage: 100, badge: "complete", incompleteFields: [] };
  }

  let totalWeight = 0;
  let filledWeight = 0;
  const incompleteFields: Array<{ fieldName: string; tipKey: string | null }> = [];

  for (const field of completionFields) {
    totalWeight += field.weight;
    const value = user[field.fieldName];
    if (value !== null && value !== undefined && value !== "") {
      filledWeight += field.weight;
    } else {
      incompleteFields.push({
        fieldName: field.fieldName,
        tipKey: field.tipKey,
      });
    }
  }

  const percentage = totalWeight > 0 ? Math.round((filledWeight / totalWeight) * 100) : 0;
  const badge = getCompletionBadge(percentage);

  return { percentage, badge, incompleteFields };
}

/**
 * Returns badge label based on completion percentage.
 */
export function getCompletionBadge(percentage: number): ProfileCompletionBadge {
  if (percentage >= 90) return "complete";
  if (percentage >= 70) return "advanced";
  if (percentage >= 40) return "intermediate";
  return "new_seller";
}

/**
 * Validates SIRET format: 14 digits + Luhn check on SIREN component.
 */
export function validateSiret(siret: string): boolean {
  if (!/^\d{14}$/.test(siret)) return false;
  return validateSirenLuhn(siret.substring(0, 9));
}

export default class ProfileService extends cds.ApplicationService {
  identityProvider: IIdentityProviderAdapter | null = null;

  async init() {
    try {
      this.identityProvider = getIdentityProvider();
    } catch {
      // Identity provider not configured — profile updates won't sync to AD B2C
    }

    this.on("READ", "UserProfiles", this.getUserProfile);
    this.on("READ", "PublicSellerProfiles", this.getPublicSellerProfiles);
    this.on("READ", "ConfigProfileFields", this.getConfigProfileFields);
    this.on("updateProfile", this.updateProfile);
    this.on("getProfileCompletion", this.getProfileCompletion);
    this.on("getPublicSellerProfile", this.getPublicSellerProfileAction);
    await super.init();
  }

  private getUserProfile = async (req: cds.Request) => {
    const userId = req.user?.id;
    if (!userId) return req.reject(401, "Authentication required");

    const { User } = cds.entities("auto");
    return cds.run(SELECT.from(User).where({ azureAdB2cId: userId }));
  };

  private getPublicSellerProfiles = async () => {
    const { User } = cds.entities("auto");
    return cds.run(
      SELECT.from(User)
        .columns("ID", "displayName", "avatarUrl", "bio", "accountCreatedAt", "isAnonymized")
        .where({ isAnonymized: false, status: "active" }),
    );
  };

  private getConfigProfileFields = async () => {
    const { ConfigProfileField } = cds.entities("auto");
    return cds.run(SELECT.from(ConfigProfileField).orderBy("displayOrder asc"));
  };

  private updateProfile = async (req: cds.Request) => {
    const userId = req.user?.id;
    if (!userId) return req.reject(401, "Authentication required");

    const input = req.data.input;

    // Validate with Zod
    const parsed = profileUpdateInputSchema.safeParse(input);
    if (!parsed.success) {
      const messages = parsed.error.issues.map((i) => i.message).join("; ");
      return req.reject(400, messages);
    }

    // Additional SIRET validation with Luhn check
    if (parsed.data.siret && parsed.data.siret !== "") {
      if (!validateSiret(parsed.data.siret)) {
        return req.reject(400, "Le numéro SIRET est invalide");
      }
    }

    const { User, SellerRating, ConfigProfileField } = cds.entities("auto");

    // Find user by Azure AD B2C ID
    const user = await cds.run(SELECT.one.from(User).where({ azureAdB2cId: userId }));
    if (!user) return req.reject(404, "User not found");

    // Build update data — only include fields that were provided
    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) {
        updateData[key] = value === "" ? null : value;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return { success: true, userId: user.ID };
    }

    // Update User entity
    await cds.run(UPDATE(User).set(updateData).where({ ID: user.ID }));

    // Recalculate profile completion
    const updatedUser = await cds.run(SELECT.one.from(User).where({ ID: user.ID }));
    const configFields = await cds.run(
      SELECT.from(ConfigProfileField).where({ contributesToCompletion: true }),
    );
    const completion = calculateProfileCompletion(updatedUser, configFields);

    // Upsert SellerRating
    const existingRating = await cds.run(SELECT.one.from(SellerRating).where({ user_ID: user.ID }));
    const ratingScore = parseFloat((completion.percentage / 20).toFixed(2)); // 0-100 → 0-5 scale

    if (existingRating) {
      await cds.run(
        UPDATE(SellerRating)
          .set({
            profileCompletionRate: completion.percentage,
            overallRating: ratingScore,
            lastCalculatedAt: new Date().toISOString(),
          })
          .where({ ID: existingRating.ID }),
      );
    } else {
      await cds.run(
        INSERT.into(SellerRating).entries({
          ID: cds.utils.uuid(),
          user_ID: user.ID,
          profileCompletionRate: completion.percentage,
          overallRating: ratingScore,
          totalListings: 0,
          lastCalculatedAt: new Date().toISOString(),
        }),
      );
    }

    // Sync to Azure AD B2C (best-effort)
    if (this.identityProvider && user.azureAdB2cId) {
      try {
        const syncData: Record<string, unknown> = {};
        if (updateData.displayName) syncData.displayName = updateData.displayName;
        if (updateData.phone) syncData.mobilePhone = updateData.phone;
        if (Object.keys(syncData).length > 0) {
          await this.identityProvider.updateUser(user.azureAdB2cId, syncData);
        }
      } catch {
        // Best-effort sync — do not block profile save
      }
    }

    return { success: true, userId: user.ID };
  };

  private getProfileCompletion = async (req: cds.Request) => {
    const targetUserId = req.data.userId;
    const requestingUserId = req.user?.id;
    if (!requestingUserId) return req.reject(401, "Authentication required");

    const { User, ConfigProfileField } = cds.entities("auto");

    const user = targetUserId
      ? await cds.run(SELECT.one.from(User).where({ ID: targetUserId }))
      : await cds.run(SELECT.one.from(User).where({ azureAdB2cId: requestingUserId }));

    if (!user) return req.reject(404, "User not found");

    const configFields = await cds.run(
      SELECT.from(ConfigProfileField).where({ contributesToCompletion: true }),
    );

    return calculateProfileCompletion(user, configFields);
  };

  private getPublicSellerProfileAction = async (req: cds.Request) => {
    const sellerId = req.data.sellerId;
    if (!sellerId) return req.reject(400, "sellerId is required");

    const { User, SellerRating, ConfigProfileField } = cds.entities("auto");

    const seller = await cds.run(SELECT.one.from(User).where({ ID: sellerId }));
    if (!seller) return req.reject(404, "Seller not found");

    // Anonymized seller
    if (seller.isAnonymized) {
      return {
        userId: seller.ID,
        displayName: "Utilisateur anonymisé",
        avatarUrl: null,
        bio: null,
        rating: 0,
        profileCompletionBadge: "new_seller",
        totalListings: 0,
        memberSince: seller.accountCreatedAt || seller.createdAt,
        isAnonymized: true,
      };
    }

    // Get seller rating
    const rating = await cds.run(SELECT.one.from(SellerRating).where({ user_ID: seller.ID }));

    // Get public visible fields config
    const configFields = await cds.run(
      SELECT.from(ConfigProfileField).where({ contributesToCompletion: true }),
    );
    const completion = calculateProfileCompletion(seller, configFields);

    return {
      userId: seller.ID,
      displayName: seller.displayName || `${seller.firstName} ${seller.lastName}`,
      avatarUrl: seller.avatarUrl || null,
      bio: seller.bio || null,
      rating: rating?.overallRating || 0,
      profileCompletionBadge: completion.badge,
      totalListings: rating?.totalListings || 0,
      memberSince: seller.accountCreatedAt || seller.createdAt,
      isAnonymized: false,
    };
  };
}
