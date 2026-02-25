using {auto} from '../db/schema';

@path    : '/api/catalog'
service CatalogService {
  /** Published listings (public, read-only) — restricted columns, no PII */
  @readonly
  entity Listings as projection on auto.Listing {
    ID, make, model, variant, year, price, mileage,
    fuelType, gearbox, bodyType, color, condition,
    engineCapacityCc, powerKw, powerHp, doors, seats,
    co2GKm, euroNorm, energyClass, critAirLevel, critAirLabel,
    description, options, interiorColor, exteriorColor,
    transmission, driveType, registrationDate,
    status, visibilityScore, visibilityLabel,
    certificationLevel, ctValid,
    publishedAt, soldAt, sellerId,
    latitude, longitude, city, postalCode
  };

  /** Card configuration (public, read-only) */
  @readonly
  entity ConfigListingCards as projection on auto.ConfigListingCard;

  /** Get published listings with pagination, filtering, and sorting */
  action getListings(
    skip         : Integer,
    top          : Integer,
    search       : String(200),
    // Filters (Story 4-2)
    minPrice     : Decimal(10, 2),
    maxPrice     : Decimal(10, 2),
    make         : String(100),
    model        : String(100),
    minYear      : Integer,
    maxYear      : Integer,
    maxMileage   : Integer,
    fuelType     : LargeString,    // JSON array of fuel types
    gearbox      : LargeString,    // JSON array of gearbox types
    bodyType     : LargeString,    // JSON array of body types
    color        : LargeString,    // JSON array of colors
    // Certification & market filters (Story 4-3)
    certificationLevel : LargeString,  // JSON array of certification levels
    ctValid      : Boolean,            // filter by valid CT only
    marketPosition : String(20),       // below, aligned, above
    // Location radius search
    latitude     : Decimal(9, 6),
    longitude    : Decimal(9, 6),
    radius       : Integer,        // km
    // Sort
    sort         : String(30)      // price_asc, price_desc, date_desc, mileage_asc, relevance
  ) returns {
    items   : LargeString;   // JSON array of IPublicListingCard
    total   : Integer;
    skip    : Integer;
    top     : Integer;
    hasMore : Boolean;
  };

  /** Get a single listing with full detail for the detail page */
  action getListingDetail(
    listingId : String(36) not null
  ) returns {
    listing : LargeString;   // JSON: IPublicListingDetail
  };
}
