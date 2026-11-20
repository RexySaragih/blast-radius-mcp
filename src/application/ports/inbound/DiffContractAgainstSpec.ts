export type ContractDriftCode = 'MISSING_IN_SPEC' | 'MISSING_IN_CODE' | 'TYPE_MISMATCH';

export type ContractDriftItem = {
  code: ContractDriftCode;
  name: string;
  detail: string;
};

export type DiffContractInput = {
  spec_path: string;
  modified_controller?: string;
};

export type ContractDriftOutput = {
  kind: 'openapi' | 'graphql' | 'protobuf';
  drifts: ContractDriftItem[];
};

export interface DiffContractAgainstSpec {
  execute(input: DiffContractInput): Promise<ContractDriftOutput>;
}
