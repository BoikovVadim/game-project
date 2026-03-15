import { useEffect, useState } from "react";
import axios from "axios";

export type ReferralTreeNode = {
  id: number;
  displayName: string;
  referrerId: number | null;
  avatarUrl?: string | null;
};

export type ReferralTreeData = {
  rootUserId?: number;
  levels: ReferralTreeNode[][];
} | null;

type UsePartnerReferralDataArgs = {
  section: string | null;
  token: string;
  userId?: number | null;
  referralCodeFromProfile?: string | null;
};

export function usePartnerReferralData({
  section,
  token,
  userId,
  referralCodeFromProfile,
}: UsePartnerReferralDataArgs) {
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralTree, setReferralTree] = useState<ReferralTreeData>(null);
  const [referralTreeLoading, setReferralTreeLoading] = useState(false);
  const [referralTreeError, setReferralTreeError] = useState("");
  const [partnerDetailExpandedIds, setPartnerDetailExpandedIds] = useState<
    Set<number>
  >(new Set());

  useEffect(() => {
    if (section !== "partner" || !token) return;

    if (referralCodeFromProfile) {
      setReferralCode(referralCodeFromProfile);
    } else {
      axios
        .post<{ referralCode: string | null }>(
          "/users/me/referral-code/ensure",
          {},
          { headers: { Authorization: `Bearer ${token}` } },
        )
        .then((res) => setReferralCode(res.data.referralCode))
        .catch(() => setReferralCode(null));
    }

    setReferralTreeError("");
    setReferralTreeLoading(true);
    const treeUrl = `/users/referral-tree?t=${Date.now()}`;
    axios
      .get<{
        rootUserId?: number;
        levels: ReferralTreeNode[][];
      }>(treeUrl, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        const data = res.data;
        const rootId = data.rootUserId ?? Number(userId) ?? 0;
        setReferralTree({ ...data, rootUserId: rootId });
      })
      .catch((e) => {
        setReferralTree(null);
        setReferralTreeError(
          e?.response?.data?.message ||
            e?.message ||
            "Не удалось загрузить древо рефералов",
        );
      })
      .finally(() => setReferralTreeLoading(false));
  }, [section, token, userId, referralCodeFromProfile]);

  return {
    referralCode,
    referralTree,
    referralTreeLoading,
    referralTreeError,
    partnerDetailExpandedIds,
    setPartnerDetailExpandedIds,
  };
}
