with open("data/gdp.csv", "r", encoding="utf-8") as f:
    for i in range(15):
        print(f.readline().strip())