namespace auto;

using {cuid} from '@sap/cds/common';

@assert.unique: {fieldName}
entity ConfigRegistrationField : cuid {
  fieldName         : String(50);
  fieldType         : String(20);
  isRequired        : Boolean;
  isVisible         : Boolean;
  displayOrder      : Integer;
  validationPattern : String(255);
  labelKey          : String(100);
  placeholderKey    : String(100);
}

@assert.unique: {key}
entity ConfigParameter : cuid {
  key         : String(100);
  value       : String(500);
  description : String(500);
}
