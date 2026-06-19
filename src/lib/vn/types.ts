export type VNSerializedKind =
  | 'Null'
  | 'String'
  | 'Int'
  | 'Float'
  | 'Double'
  | 'Bool'
  | 'Enum'
  | 'Vector2'
  | 'Vector3'
  | 'Color'
  | 'List'
  | 'Object';

export interface VNSerializedValue {
  Kind: VNSerializedKind | string;
  StringValue?: string | null;
  NumberValue?: number;
  BoolValue?: boolean;
  X?: number;
  Y?: number;
  Z?: number;
  W?: number;
  Items?: VNSerializedValue[] | null;
  ObjectValue?: Record<string, VNSerializedValue> | null;
}

export interface VNNodeSaveData {
  Index: number;
  DisplayName?: string | null;
  Comment?: string | null;
  NodeType: number | string;
  SubType: number;
  X: number;
  Y: number;
  Data: Record<string, VNSerializedValue>;
  Outputs: Record<string, number[]>;
}

export interface VNGraphSaveData {
  Version: number;
  StartNodeIndex: number;
  Nodes: VNNodeSaveData[];
  InheritedAssets?: string[] | null;
}

export interface VNValueSchema {
  Kind: VNSerializedKind | string;
  EnumName?: string;
  EnumValues?: string[];
  CollisionRelaxed?: boolean;
  ObjectSchema?: Record<string, VNValueSchema>;
  RequiredFields?: string[];
  ItemSchema?: VNValueSchema;
  SampleValue?: VNSerializedValue;
}

export interface VNOutputSchema {
  Key: string;
  PortName?: string;
  Capacity: number;
  AllowedTargetTypes?: string[];
  AllowedTargetTypeValues?: number[];
  TargetsProgress?: boolean;
}

export interface VNDynamicOutputSchema {
  ListFieldName: string;
  ElementTypeName?: string;
  ElementOutputName: string;
  KeyTemplate: string;
  PortName?: string;
  Capacity: number;
  AllowedTargetTypes?: string[];
  AllowedTargetTypeValues?: number[];
  TargetsProgress?: boolean;
}

export interface VNRequiredListConstraint {
  Field: string;
  MinItems?: number;
  MaxItems?: number;
  Source?: string;
}

export interface VNResourceFieldSchema {
  NodeType: string;
  NodeTypeValue: number;
  SubType: number;
  SubTypeName: string;
  RootFieldName: string;
  FieldName: string;
  FieldPath: string;
  AssetType: string;
  AssetTypeValue: number;
  Category: string;
  CategoryValue: number;
  IsTopLevelField: boolean;
}

export interface VNNodeFactorySchema {
  Key: string;
  NodeType: string;
  NodeTypeValue: number;
  SubType: number;
  SubTypeName: string;
  TypeName?: string;
  DisplayName?: string;
  MenuPath?: string;
  Fields: Record<string, VNValueSchema>;
  Outputs: VNOutputSchema[];
  FixedOutputs?: VNOutputSchema[];
  DynamicOutputs?: VNDynamicOutputSchema[];
  RequiredDataFields?: string[];
  RequiredListConstraints?: VNRequiredListConstraint[];
  ResourceFields?: VNResourceFieldSchema[];
}

export interface VNGraphRulesSchema {
  VersionMustEqual?: number;
  InheritedAssetsMustBeEmpty?: boolean;
  NodesMustBeNonEmpty?: boolean;
  NodeIndexMustBePositive?: boolean;
  NodeIndexesMustBeUnique?: boolean;
  ExactlyOneStartNode?: boolean;
  StartNodeIndexMustPointToSingleStart?: boolean;
  CoordinatesMustBeFinite?: boolean;
  OutputsMustBeObjectWithArrayValues?: boolean;
  OutputTargetsMustExist?: boolean;
  OutputCapacityMustNotBeExceeded?: boolean;
  OutputTargetTypesMustMatch?: boolean;
  UnknownOutputKeysRejected?: boolean;
  AllNodesMustBeReachableFromStart?: boolean;
  RequireEndingTerminalRule?: string;
}

export interface VNNodeSchemaDocument {
  SchemaVersion: number;
  GraphVersion: number;
  NodeFactoryCount: number;
  ResourceFieldCount: number;
  Nodes: VNNodeFactorySchema[];
  ResourceFields?: VNResourceFieldSchema[];
  GraphRules?: VNGraphRulesSchema;
}

export interface VNCharacterEntry {
  id?: string;
  Id?: string;
  displayName?: string;
  DisplayName?: string;
  aliases?: string[];
  Aliases?: string[];
  name?: string;
  Name?: string;
}

export interface VNCharacterTable {
  entries?: VNCharacterEntry[];
  Entries?: VNCharacterEntry[];
  isKnownSpeaker?: (speakerId: string) => boolean;
}

export interface VNAssetWhitelist {
  contains: (category: string, scopedAssetId: string) => boolean;
}

export interface VNAssetResolver {
  resolve: (scopedAssetId: string, assetType: string, category: string) => string | boolean | null | undefined;
}

export interface VNGraphValidationOptions {
  schema?: VNNodeSchemaDocument;
  characterTable?: VNCharacterTable;
  knownSpeakers?: string[];
  assetWhitelist?: VNAssetWhitelist;
  assetResolver?: VNAssetResolver;
  requireEndingTerminal?: boolean;
}

export interface VNGraphValidationResult {
  valid: boolean;
  error: string;
  errors: string[];
}

export interface VNOutputSpec {
  Key: string;
  Capacity: number;
  AllowedTargetTypeValues: number[];
  TargetsProgress: boolean;
}
