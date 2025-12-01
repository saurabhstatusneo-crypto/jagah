pipeline {
    agent any

    environment {
        GIT_URL       = "https://github.com/saurabhstatusneo-crypto/jagah.git"
        SOURCE_BRANCH = "main"
        PR_BRANCH     = "auto-update-${env.BUILD_NUMBER}"
    }

    stages {
        stage('Checkout Source') {
            steps {
                git branch: "${SOURCE_BRANCH}",
                    credentialsId: "GitHub-Credentials",
                    url: "${GIT_URL}"
            }
        }

        stage('Modify File') {
            steps {
                sh '''
                    echo "🌞 Timestamp added by Jenkins: $(date)" >> update.txt
                '''
            }
        }
stage('Commit & Push') {
    steps {
        withCredentials([
            string(credentialsId: 'GITHUB_TOKEN', variable: 'TOKEN')
        ]) {
            sh '''
                git config user.email "jenkins@automation.local"
                git config user.name "Jenkins Bot"

                git checkout -b ${PR_BRANCH}
                git add update.txt
                git commit -m "Auto: Timestamp update by Jenkins"

                # Extract the host+path from the repo URL (everything after https://)
                CLEAN_URL=$(echo "${GIT_URL}" | sed 's#https://##')

                # Build authenticated URL (no masking issues)
                AUTH_URL="https://${TOKEN}@${CLEAN_URL}"

                # Push to branch
                git push "${AUTH_URL}" ${PR_BRANCH}
            '''
        }
    }
}

    }
}
