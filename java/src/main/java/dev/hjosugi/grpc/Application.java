package dev.hjosugi.grpc;

import java.util.Arrays;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        var context = SpringApplication.run(Application.class, args);
        if (Arrays.asList(context.getEnvironment().getActiveProfiles()).contains("client")) {
            context.close();
        }
    }
}
