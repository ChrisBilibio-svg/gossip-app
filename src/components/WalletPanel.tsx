import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import {
  DEFAULT_DISABLED_ECONOMY_STATE,
  getCoinEconomyState,
  getWalletHistory,
  noCashValueReminder,
  walletTransactionLabel,
  type EconomyState,
  type WalletTransaction,
} from '../lib/economy';

export default function WalletPanel({ onOpenPro }: { onOpenPro?: () => void }) {
  const { colors } = useTheme();
  const [state, setState] = useState<EconomyState>(DEFAULT_DISABLED_ECONOMY_STATE);
  const [history, setHistory] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([getCoinEconomyState(), getWalletHistory(8)]).then(([economy, rows]) => {
      if (!active) return;
      setState(economy);
      setHistory(rows);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}> 
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!state.featureEnabled) {
    return (
      <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}> 
        <View style={styles.headRow}>
          <View>
            <Text style={[styles.title, { color: colors.text }]}>Carteira de moedas</Text>
            <Text style={[styles.subtitle, { color: colors.faint }]}>desativada por feature flag</Text>
          </View>
          <Feather name="lock" size={16} color={colors.faint} />
        </View>
        <Text style={[styles.copy, { color: colors.muted }]}>
          A economia de moedas está pronta no código, mas só será ativada após revisão legal no Brasil, age rating e pagamentos verificados no servidor.
        </Text>
        <Text style={[styles.disclaimer, { color: colors.faint }]}>{noCashValueReminder()}</Text>
      </View>
    );
  }

  const nextGrant = state.nextGrantAt ? new Date(state.nextGrantAt).toLocaleString('pt-BR') : '—';
  const expires = state.proExpiresAt ? new Date(state.proExpiresAt).toLocaleDateString('pt-BR') : '—';

  return (
    <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}> 
      <View style={styles.headRow}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Carteira</Text>
          <Text style={[styles.subtitle, { color: colors.faint }]}>config v{state.economyConfigVersion ?? '—'} · moeda fechada</Text>
        </View>
        <Text style={[styles.balance, { color: colors.gold }]}>{state.balance.toLocaleString('pt-BR')} 🪙</Text>
      </View>

      <View style={styles.statusGrid}>
        <Info label="Pro" value={state.isPro ? state.proStatus ?? 'ativo' : 'não ativo'} />
        <Info label="Próximo grant" value={nextGrant} />
        <Info label="Expira/renova" value={expires} />
        <Info label="Compras" value={state.purchasesKilled ? 'pausadas' : 'ativas'} />
      </View>

      <Pressable onPress={() => setExpanded((value) => !value)} accessibilityRole="button" style={styles.historyToggle}>
        <Text style={[styles.historyTitle, { color: colors.text }]}>Histórico da carteira</Text>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.faint} />
      </Pressable>
      {expanded ? (
        history.length === 0 ? (
          <Text style={[styles.copy, { color: colors.faint }]}>Nenhum movimento ainda.</Text>
        ) : (
          <View style={styles.historyList}>
            {history.map((tx) => (
              <View key={tx.id} style={[styles.txRow, { borderTopColor: colors.border }]}> 
                <View style={{ flex: 1 }}>
                  <Text style={[styles.txLabel, { color: colors.text }]}>{walletTransactionLabel(tx.transactionType, tx.signedAmount)}</Text>
                  <Text style={[styles.txMeta, { color: colors.faint }]}>saldo depois: {tx.balanceAfter.toLocaleString('pt-BR')} · v{tx.economyConfigVersion}</Text>
                </View>
                <Text style={[styles.txAmount, { color: tx.signedAmount >= 0 ? colors.tea : colors.capRed }]}>
                  {tx.signedAmount > 0 ? '+' : ''}{tx.signedAmount.toLocaleString('pt-BR')}
                </Text>
              </View>
            ))}
          </View>
        )
      ) : null}

      <Pressable
        onPress={onOpenPro}
        accessibilityRole="button"
        style={[styles.proBtn, { backgroundColor: colors.primaryBg, borderColor: colors.primaryBorder }]}
      >
        <Text style={[styles.proBtnText, { color: colors.primary }]}>Ver Pro, restauração e termos</Text>
      </Pressable>
      <Text style={[styles.disclaimer, { color: colors.faint }]}>{state.legalCopy}</Text>
    </View>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.info, { backgroundColor: colors.raised }]}> 
      <Text style={[styles.infoValue, { color: colors.text }]} numberOfLines={1}>{value}</Text>
      <Text style={[styles.infoLabel, { color: colors.faint }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.md },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md },
  title: { fontFamily: fonts.serifBold, fontWeight: '700', fontSize: 17 },
  subtitle: { fontFamily: fonts.mono, fontSize: 10, marginTop: 2 },
  balance: { fontFamily: fonts.monoBold, fontSize: 18 },
  copy: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18 },
  disclaimer: { fontFamily: fonts.sans, fontSize: 10, lineHeight: 15 },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  info: { width: '48%', borderRadius: radius.sm, padding: spacing.sm },
  infoValue: { fontFamily: fonts.monoSemi, fontSize: 11 },
  infoLabel: { fontFamily: fonts.sans, fontSize: 10, marginTop: 2 },
  historyToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  historyTitle: { fontFamily: fonts.sansSemi, fontSize: 12 },
  historyList: { gap: 0 },
  txRow: { borderTopWidth: 1, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  txLabel: { fontFamily: fonts.sansSemi, fontSize: 12 },
  txMeta: { fontFamily: fonts.mono, fontSize: 9, marginTop: 2 },
  txAmount: { fontFamily: fonts.monoBold, fontSize: 12 },
  proBtn: { borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: 'center' },
  proBtnText: { fontFamily: fonts.sansSemi, fontSize: 12 },
});
