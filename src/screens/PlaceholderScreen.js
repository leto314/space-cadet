import { StyleSheet, Text, View } from "react-native";
import { SPACE_CADET } from "../theme/spaceCadet";

export function PlaceholderScreen({ title }) {
  return <View style={styles.container}><Text style={styles.title}>{title}</Text></View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.black },
  title: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 24 },
});
