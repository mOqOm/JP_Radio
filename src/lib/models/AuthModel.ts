export interface LoginAccount {
  mail: string;
  pass: string;
}

export interface LoginState {
  areafree: string;
  member_type: {
    type: string;
  };
  [key: string]: any; // 他のプロパティがある場合の保険
}
