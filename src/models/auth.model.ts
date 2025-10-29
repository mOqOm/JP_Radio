export interface LoginAccount {
  mail: string;
  pass: string;
}

export interface LoginState {
  areafree: string;
  member_type: {
    type: string;
  };
  // 他のプロパティがある場合の保険
  [key: string]: any;
}
