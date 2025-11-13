export interface LoginAccount {
  mail: string;
  pass: string;
}

export interface LoginState {
  status: string;
  member_type: {
    name: string;
    type: string;
  };
  expired: string;
  user_key: string;
  // 他のプロパティがある場合の保険
  [key: string]: any;
}
