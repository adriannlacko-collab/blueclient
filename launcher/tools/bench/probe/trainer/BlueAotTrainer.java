/**
 * A windowless AOT training run (tools/bench/README.md, "AOT cache").
 *
 * JDK 25's AOT cache only holds classes the built-in loaders define — the
 * JDK's own and the libraries on -cp — never the game's or the mods', which
 * Fabric's Knot loader defines itself. So the training does not need the game
 * at all: this loads, without initialising, every class named in the list
 * file (one binary name a line — the classes a real launch had the built-in
 * loaders define), under -XX:AOTMode=record, and exits.
 *
 *   java -XX:AOTMode=record -XX:AOTConfiguration=x.aotconf -cp <game classpath>:<this> BlueAotTrainer list.txt
 *   java -XX:AOTMode=create -XX:AOTConfiguration=x.aotconf -XX:AOTCache=x.aot -cp <same> BlueAotTrainer list.txt
 */
public final class BlueAotTrainer {
    public static void main(String[] args) throws Exception {
        ClassLoader app = ClassLoader.getSystemClassLoader();
        int ok = 0;
        int missing = 0;
        for (String line : java.nio.file.Files.readAllLines(java.nio.file.Paths.get(args[0]))) {
            String name = line.trim();
            if (name.isEmpty()) continue;
            try {
                Class.forName(name, false, app);
                ok++;
            } catch (Throwable t) {
                missing++;
            }
        }
        System.out.println("BlueAotTrainer loaded " + ok + " classes, " + missing + " not found");
    }
}
